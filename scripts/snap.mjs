import Database from 'better-sqlite3';
import fs from 'fs';
import { execFileSync } from 'child_process';
const db = new Database('/app/data/peanut-family.db', { readonly: true });
const media = db.prepare("SELECT COUNT(*) c FROM media").get().c;
const video = db.prepare("SELECT COUNT(*) c FROM media WHERE type='video'").get().c;
const image = db.prepare("SELECT COUNT(*) c FROM media WHERE type='image'").get().c;
const delLog = db.prepare("SELECT COUNT(*) c FROM migration_log WHERE status='deleted-corrupt'").get().c;
// 비디오 무결성 (HLS 또는 ffprobe 통과)
const vids = db.prepare("SELECT filename FROM media WHERE type='video'").all();
let hls = 0, playable = 0, broken = 0, nofile = 0;
for (const r of vids) {
  const orig = '/app/data/originals/' + r.filename;
  if (!fs.existsSync(orig)) { nofile++; continue; }
  if (fs.existsSync('/app/data/hls/' + r.filename + '/playlist.m3u8')) { hls++; continue; }
  try { execFileSync('ffprobe', ['-v', 'error', '-i', orig], { timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }); playable++; }
  catch { broken++; }
}
const out = { media, video, image, sum: video + image, delLog, vHls: hls, vPlayable: playable, vBroken: broken, vNoFile: nofile };
fs.writeFileSync('/app/data/SNAPSHOT.json', JSON.stringify(out));
