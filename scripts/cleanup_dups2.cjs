// 중복 정리 2차 — 내용검증 기반(안전). DRY=1이면 아무것도 안 바꾸고 '무엇을 지울지'만 로그.
// Pass A: 동일 quick-hash 그룹(업로드 레이스로 양쪽 삽입된 진짜 동일본). 이미지=픽셀,영상=프레임 검증.
// Pass B: 영상 (uploaderId,size,width,height) 동일하나 hash 다른 그룹(이관↔백업). 프레임+길이 동일할 때만.
// 둘 다: 보존본 1개 선택 → engagement 재지정 → 나머지 파일은 _dup_trash로 이동 + 행 삭제.
const crypto=require('crypto'), fs=require('fs'), cp=require('child_process');
let sharp=null; try{ sharp=require('sharp'); }catch(e){}
const DB='/app/data/peanut-family.db';
const ORIG='/app/data/originals/', TRASH='/app/data/_dup_trash/';
const DRY=process.env.DRY==='1';
const LOG='/app/data/cleanup_dups2.log';
fs.mkdirSync(TRASH,{recursive:true});
const log=(...a)=>{ const s=a.join(' '); fs.appendFileSync(LOG,s+'\n'); };

const db=require('better-sqlite3')(DB);
db.pragma('busy_timeout=15000');
let peanut=null; try{ peanut=require('better-sqlite3')('/app/data-peanut/peanut.db',{readonly:true}); }catch(e){}
const pStmt=peanut?peanut.prepare('SELECT 1 FROM media WHERE hash=?'):null;

const ENG=['views','downloads','likes','comments','favorites','shares','album_items'];
const repoint=db.transaction((from,to)=>{ for(const t of ENG){ try{ db.prepare(`UPDATE OR IGNORE ${t} SET mediaId=? WHERE mediaId=?`).run(to,from); db.prepare(`DELETE FROM ${t} WHERE mediaId=?`).run(from);}catch(e){} } });

function pixhash(fn){ const fp=ORIG+fn; if(!fs.existsSync(fp))return'NOFILE';
  if(sharp){ try{ const b=sharp(fp,{failOn:'none'}); return b.raw().toBuffer().then(buf=>crypto.createHash('sha256').update(buf).digest('hex')).catch(()=>framehash(fn)); }catch(e){} }
  return Promise.resolve(framehash(fn)); }
function framehash(fn){ const fp=ORIG+fn; if(!fs.existsSync(fp))return'NOFILE';
  try{ const out=cp.execSync(`ffmpeg -v error -ss 0.5 -i "${fp}" -frames:v 1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null`,{maxBuffer:1<<30});
    if(!out||out.length===0)return'EMPTY'; return crypto.createHash('sha256').update(out).digest('hex'); }catch(e){return'ERR';} }
async function contentHash(r){ return r.type==='image' ? await pixhash(r.filename) : framehash(r.filename); }

function score(r){ return (r.ab?1e4:0)+(r.pn?1e3:0)+(r.visibility==='shared'?100:0)+r.eng*10; }
const enrich=db.prepare("SELECT id,filename,hash,type,visibility,uploadedAt,duration,width,height,(SELECT COUNT(*) FROM album_items WHERE mediaId=media.id) ab,(SELECT COUNT(*) FROM likes WHERE mediaId=media.id)+(SELECT COUNT(*) FROM comments WHERE mediaId=media.id) eng FROM media WHERE id=?");

let del=0,moved=0,errs=0,kept=0,skip=0;
function dedupeSet(set,label){ // set = content-identical rows (>=2)
  set.forEach(r=>{ r.pn=(pStmt&&r.hash&&pStmt.get(r.hash))?1:0; });
  set.sort((a,b)=>score(b)-score(a)||(b.uploadedAt>a.uploadedAt?1:-1));
  const keeper=set[0]; if(!fs.existsSync(ORIG+keeper.filename)){ log('SKIP keeper-missing',keeper.id); skip++; return; }
  kept++;
  for(const r of set.slice(1)){
    log(`${DRY?'DRY ':''}DEL ${label} dup#${r.id} -> keep#${keeper.id} (${r.filename})`);
    if(DRY){ del++; continue; }
    try{ repoint(r.id,keeper.id); db.prepare('DELETE FROM media WHERE id=?').run(r.id); del++;
      if(fs.existsSync(ORIG+r.filename)){ fs.renameSync(ORIG+r.filename,TRASH+r.id+'_'+r.filename); moved++; }
      for(const ext of ['.webp']){ const tp='/app/data/thumbnails/'+r.filename+ext; if(fs.existsSync(tp)) try{fs.unlinkSync(tp);}catch(e){} }
      const hd='/app/data/hls/'+r.filename; if(fs.existsSync(hd)) try{fs.rmSync(hd,{recursive:true});}catch(e){}
    }catch(e){ errs++; log('ERR',r.id,e.message); }
  }
}

(async()=>{
  fs.writeFileSync(LOG,`START ${DRY?'(DRY RUN)':'(LIVE)'} ${new Date().toISOString()}\n`);
  if(!DRY){ await db.backup(`${DB}.predup2-${Date.now()}`); log('DB backup done'); }

  // ---- Pass A: 동일 hash 그룹 ----
  const hg=db.prepare("SELECT hash FROM media WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*)>1").all();
  log(`Pass A: 동일 hash 그룹 ${hg.length}`);
  for(const g of hg){
    const ids=db.prepare("SELECT id FROM media WHERE hash=?").all(g.hash).map(r=>r.id);
    const rows=ids.map(id=>enrich.get(id));
    const byc={}; for(const r of rows){ const ch=await contentHash(r); if(['NOFILE','ERR','EMPTY'].includes(ch)){errs++;continue;} (byc[ch]=byc[ch]||[]).push(r); }
    for(const ch in byc){ if(byc[ch].length>1) dedupeSet(byc[ch],'A/hash'); }
  }
  log(`After Pass A: del=${del} moved=${moved} kept=${kept} errs=${errs} skip=${skip}`);

  // ---- Pass B: 영상 size+w+h 동일, hash 다른 ----
  const vg=db.prepare("SELECT uploaderId,size,width,height FROM media WHERE type='video' AND size>0 AND width IS NOT NULL GROUP BY uploaderId,size,width,height HAVING COUNT(*)>1").all();
  log(`Pass B: 영상 size+w+h 그룹 ${vg.length}`);
  for(const g of vg){
    const ids=db.prepare("SELECT id FROM media WHERE type='video' AND uploaderId=? AND size=? AND width=? AND height=?").all(g.uploaderId,g.size,g.width,g.height).map(r=>r.id);
    if(ids.length<2) continue;
    const rows=ids.map(id=>enrich.get(id));
    const byc={}; for(const r of rows){ const ch=framehash(r.filename); if(['NOFILE','ERR','EMPTY'].includes(ch)){errs++;continue;} (byc[ch]=byc[ch]||[]).push(r); }
    for(const ch in byc){ const set=byc[ch]; if(set.length<2) continue;
      // 안전장치: 길이까지 같은 것만 동일 취급
      const k=set[0]; const same=set.filter(r=>r.duration===k.duration);
      if(same.length>1) dedupeSet(same,'B/vframe');
    }
  }
  log(`DONE ${DRY?'(DRY)':'(LIVE)'} del=${del} moved=${moved} kept=${kept} errs=${errs} skip=${skip} ${new Date().toISOString()}`);
  console.log(`del=${del} moved=${moved} kept=${kept} errs=${errs} skip=${skip}`);
})();
