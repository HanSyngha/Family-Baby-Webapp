import Database from 'better-sqlite3';
import fs from 'fs';
import { execFileSync } from 'child_process';

const db = new Database('/app/data/peanut-family.db', { readonly: true });
const vids = db.prepare("SELECT m.id, m.filename, m.size, m.originalName, m.createdAt FROM media m JOIN migration_log l ON l.mediaId = m.id WHERE l.status='done' AND m.type='video'").all();
const bad = [];
for (const r of vids) {
  if (fs.existsSync('/app/data/hls/' + r.filename + '/playlist.m3u8')) continue;
  try {
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', '/app/data/originals/' + r.filename], { timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    let real = 0; try { real = fs.statSync('/app/data/originals/' + r.filename).size; } catch {}
    bad.push({ id: r.id, real, name: r.originalName });
  }
}
const totReal = bad.reduce((s, b) => s + b.real, 0);
const zero = bad.filter(b => b.real === 0).length;
const tiny = bad.filter(b => b.real > 0 && b.real < 1024 * 1024).length; // <1MB
const big = bad.filter(b => b.real >= 100 * 1024 * 1024).length; // >=100MB
// moov 복구 시도 가능성: faststart 재작성으로 살릴 수 있는지 1개 테스트
let recoverable = 0;
for (const b of bad.slice(0, 10)) {
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-err_detect', 'ignore_err', '-i', '/app/data/originals/' + b.name === b.name ? '/app/data/originals/' : '', '-f', 'null', '-'], { timeout: 8000, stdio: 'ignore' });
  } catch {}
}
console.log(JSON.stringify({
  count: bad.length,
  totalGB: +(totReal / 1e9).toFixed(2),
  zeroByte: zero,
  under1MB: tiny,
  over100MB: big,
  largest: bad.map(b => Math.round(b.real / 1e6)).sort((a, b) => b - a).slice(0, 5),
}));
