#!/usr/bin/env python3
"""
로컬 생성 실패한 썸네일(HEVC mp4/DNG 등)을 Immich가 이미 만든 썸네일로 채운다.
family media(개인) 중 썸네일 없는 것 → migration_log로 immichId → asset_file thumbnail 경로 → reflink 복사.
Immich 삭제(P6) 전에만 가능.
"""
import sqlite3, os, subprocess

FAMILY = "/volume1/docker/peanut-family/data"
THUMBS = os.path.join(FAMILY, "thumbnails")
IMMICH_LIB = "/volume1/docker/immich/library"
PREFIX = "/usr/src/app/upload/"

con = sqlite3.connect(f"file:{FAMILY}/peanut-family.db?mode=ro", uri=True)
rows = con.execute("SELECT id, filename FROM media WHERE visibility='private' AND ownerId=1").fetchall()
missing = [(mid, fn) for (mid, fn) in rows if not os.path.exists(os.path.join(THUMBS, fn + ".webp"))]
log = dict((mid, iid) for (mid, iid) in con.execute(
    "SELECT mediaId, immichId FROM migration_log WHERE mediaId IS NOT NULL").fetchall())
con.close()
print(f"[fill] 썸네일 없는 개인 미디어: {len(missing)}")
if not missing:
    print("[fill] 채울 것 없음"); raise SystemExit

iids = list({log[m] for (m, f) in missing if m in log})
ids_sql = ",".join("'" + i + "'" for i in iids)
out = subprocess.run(["docker", "exec", "immich_postgres", "psql", "-U", "postgres", "-d", "immich",
                      "-t", "-A", "-F", "\t", "-c",
                      f'SELECT "assetId", path FROM asset_file WHERE type=\'thumbnail\' AND "assetId" IN ({ids_sql})'],
                     capture_output=True, text=True)
tmap = {}
for line in out.stdout.split("\n"):
    if "\t" in line:
        aid, p = line.split("\t", 1)
        tmap[aid] = p
print(f"[fill] Immich 썸네일 경로 확보: {len(tmap)}")

ok = noimmich = err = 0
for (mid, fn) in missing:
    iid = log.get(mid)
    p = tmap.get(iid)
    if not p:
        noimmich += 1; continue
    hp = p.replace(PREFIX, IMMICH_LIB + "/")
    if not os.path.exists(hp):
        noimmich += 1; continue
    dst = os.path.join(THUMBS, fn + ".webp")
    tmp = dst + ".part"
    try:
        rc = subprocess.run(["cp", "--reflink=auto", hp, tmp], capture_output=True)
        if rc.returncode != 0:
            import shutil; shutil.copyfile(hp, tmp)
        os.rename(tmp, dst)
        ok += 1
    except Exception as e:
        err += 1
        if err <= 5: print("[fill] ERR", fn, str(e)[:100])

print(f"[fill] DONE filled={ok} immich썸네일없음={noimmich} err={err} / missing={len(missing)}")
