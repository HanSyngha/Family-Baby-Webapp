// READ-ONLY 분류. originals/ 의 DB 미참조(고아) 파일을 A/B/C로 나눈다. 아무것도 안 지움.
//  A = 기존 갤러리와 동일(quick-hash 일치) → dedup 잔재, 삭제 안전
//  B = 완전+유니크(유효한데 갤러리에 없음) → 복구 대상, 보존
//  C = 손상/잘림(ffprobe/디코드 실패) → 중간에 끊긴 쓰레기, 삭제 안전
const crypto=require('crypto'), fs=require('fs'), cp=require('child_process'), path=require('path');
const Database=require('/app/node_modules/better-sqlite3');
const DIR='/app/data/originals/';
const LOG='/app/data/classify_orphans.log';
const OUT='/app/data/orphans_classified.json';   // {A:[ids],B:[...],C:[...]} 파일명 목록(다음 단계가 사용)
const log=(...a)=>{ const s=a.join(' '); fs.appendFileSync(LOG,s+'\n'); console.log(s); };

const db=new Database('/app/data/peanut-family.db',{readonly:true});
const refFiles=new Set(db.prepare('SELECT filename FROM media').all().map(r=>r.filename));
const refHashes=new Set(db.prepare('SELECT hash FROM media WHERE hash IS NOT NULL').all().map(r=>r.hash));

const CHUNK=4*1024*1024;
function quickHash(fp,size){ const h=crypto.createHash('sha256');
  if(size<=CHUNK){ h.update(fs.readFileSync(fp)); }
  else{ const fd=fs.openSync(fp,'r'); const head=Buffer.alloc(CHUNK),tail=Buffer.alloc(CHUNK);
    fs.readSync(fd,head,0,CHUNK,0); fs.readSync(fd,tail,0,CHUNK,size-CHUNK); fs.closeSync(fd);
    h.update(head); h.update(tail); const sb=Buffer.alloc(8); sb.writeDoubleBE(size); h.update(sb); }
  return h.digest('hex'); }

function videoValid(fp){ try{
  const out=cp.execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${fp}"`,{timeout:60000,maxBuffer:1<<20}).toString().trim();
  const d=parseFloat(out); return isFinite(d)&&d>0.05;
}catch(e){ return false; } }
function jpegComplete(fp,size){ try{ const fd=fs.openSync(fp,'r'); const b=Buffer.alloc(2); fs.readSync(fd,b,0,2,size-2); fs.closeSync(fd); return b[0]===0xFF&&b[1]===0xD9; }catch(e){ return false; } }
function imageValid(fp,size,ext){
  if(ext==='.jpg'||ext==='.jpeg') return jpegComplete(fp,size);
  try{ cp.execSync(`ffprobe -v error -show_entries stream=width,height -of csv=p=0 "${fp}"`,{timeout:30000,maxBuffer:1<<20}); return true; }catch(e){ return false; }
}
const VID=new Set(['.mp4','.mov','.m4v','.3gp','.avi','.mkv','.webm']);
const IMG=new Set(['.jpg','.jpeg','.png','.heic','.heif','.webp','.gif','.dng','.tif','.tiff','.bmp']);

const res={A:[],B:[],C:[]}; const bytes={A:0,B:0,C:0};
let n=0, errs=0;
fs.writeFileSync(LOG,`START classify ${new Date().toISOString()}\n`);
const all=fs.readdirSync(DIR).filter(f=>!refFiles.has(f));
log(`고아 후보: ${all.length}`);
for(const f of all){ n++;
  let st; try{ st=fs.statSync(DIR+f); if(!st.isFile()) continue; }catch(e){ errs++; continue; }
  const ext=path.extname(f).toLowerCase(); const fp=DIR+f;
  let cat;
  try{
    if(VID.has(ext)){
      if(!videoValid(fp)) cat='C';
      else cat = refHashes.has(quickHash(fp,st.size)) ? 'A' : 'B';
    } else if(IMG.has(ext)){
      // 이미지는 타임아웃 partial이 드묾(작아서) → 먼저 dedup 확인, 아니면 유효성
      cat = refHashes.has(quickHash(fp,st.size)) ? 'A' : (imageValid(fp,st.size,ext) ? 'B' : 'C');
    } else {
      cat = refHashes.has(quickHash(fp,st.size)) ? 'A' : 'B'; // 알 수 없는 확장자는 보수적으로 보존(B)
    }
  }catch(e){ errs++; cat='C'; }
  res[cat].push(f); bytes[cat]+=st.size;
  if(n%2000===0) log(`progress ${n}/${all.length} A=${res.A.length} B=${res.B.length} C=${res.C.length} errs=${errs}`);
}
const gb=x=>(x/1073741824).toFixed(2)+'GB';
fs.writeFileSync(OUT, JSON.stringify(res));
log(`DONE ${new Date().toISOString()}`);
log(`A(중복/삭제안전): ${res.A.length}개 ${gb(bytes.A)}`);
log(`B(복구대상/보존): ${res.B.length}개 ${gb(bytes.B)}`);
log(`C(손상/삭제안전): ${res.C.length}개 ${gb(bytes.C)}`);
log(`errs=${errs}  목록저장:${OUT}`);
