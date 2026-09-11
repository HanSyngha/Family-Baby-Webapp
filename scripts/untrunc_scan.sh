#!/bin/bash
# 손상 영상 317개 전수 untrunc 복구 가능성 스캔.
# 각 손상 파일에 대해 untrunc 시도 → 복구본이 ffprobe 통과 + duration>0 이면 '복구가능'.
# 결과: data/recover/ 에 복구본 저장, data/untrunc_report.tsv 에 분류.
set -u
export PATH=/usr/local/bin:/usr/bin:$PATH
ORIG=/volume1/docker/peanut-family/data/originals
OUT=/volume1/docker/peanut-family/data/recover
REPORT=/volume1/docker/peanut-family/data/untrunc_report.tsv
C=peanut-family-peanut-family-1
mkdir -p "$OUT"
: > "$REPORT"

# 참조: 정상 GoPro (GX011187)
REF=668893b4-20f4-455c-b10d-07ad4515d272.mp4

# 손상 영상 목록(파일명) 추출: HLS 없고 ffprobe 실패한 video
docker exec "$C" node -e '
const D=require("better-sqlite3");const fs=require("fs");const {execFileSync}=require("child_process");
const db=new D("/app/data/peanut-family.db",{readonly:true});
const v=db.prepare("SELECT m.filename FROM media m JOIN migration_log l ON l.mediaId=m.id WHERE l.status=\x27done\x27 AND m.type=\x27video\x27").all();
for(const r of v){
  if(fs.existsSync("/app/data/hls/"+r.filename+"/playlist.m3u8")) continue;
  try{execFileSync("ffprobe",["-v","error","-i","/app/data/originals/"+r.filename],{timeout:10000,stdio:["ignore","pipe","ignore"]});}
  catch(e){console.log(r.filename);}
}' > /tmp/bad_list.txt 2>/dev/null

total=$(wc -l < /tmp/bad_list.txt)
echo "[scan] 손상 영상: $total 개"
i=0; recov=0; dead=0
while read -r f; do
  [ -z "$f" ] && continue
  i=$((i+1))
  # untrunc: 참조 + 손상 → OUT 에 저장 시도
  docker run --rm -v "$ORIG":/orig:ro -v "$OUT":/out untrunc-local \
    -dst "/out/${f}_fixed.mp4" "/orig/$REF" "/orig/$f" >/dev/null 2>&1
  fixed="$OUT/${f}_fixed.mp4"
  if [ -f "$fixed" ]; then
    # 복구본이 진짜 재생가능한지: duration 있는지
    dur=$(docker exec "$C" ffprobe -v error -show_entries format=duration -of csv=p=0 "/app/data/recover/${f}_fixed.mp4" 2>/dev/null)
    sz=$(stat -c %s "$fixed" 2>/dev/null || echo 0)
    if [ -n "$dur" ] && [ "${dur%.*}" -gt 0 ] 2>/dev/null; then
      echo -e "$f\tRECOVERABLE\t${dur}s\t${sz}" >> "$REPORT"; recov=$((recov+1))
    else
      echo -e "$f\tDEAD\tno-dur\t${sz}" >> "$REPORT"; dead=$((dead+1)); rm -f "$fixed"
    fi
  else
    echo -e "$f\tDEAD\tno-output\t0" >> "$REPORT"; dead=$((dead+1))
  fi
  [ $((i % 20)) -eq 0 ] && echo "[scan] $i/$total  복구가능=$recov  복구불가=$dead"
done < /tmp/bad_list.txt

echo "[scan] DONE total=$total RECOVERABLE=$recov DEAD=$dead"
echo "[scan] report: $REPORT"
