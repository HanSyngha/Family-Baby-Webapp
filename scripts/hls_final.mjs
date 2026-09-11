import Database from 'better-sqlite3';
import fs from 'fs';
import { execFileSync } from 'child_process';

const db = new Database('/app/data/peanut-family.db', { readonly: true });
const vids = db.prepare("SELECT m.filename FROM media m JOIN migration_log l ON l.mediaId = m.id WHERE l.status = 'done' AND m.type = 'video'").all();
let ok = 0, noHls = 0, corrupt = 0;
const bad = [];
for (const r of vids) {
  if (fs.existsSync('/app/data/hls/' + r.filename + '/playlist.m3u8')) { ok++; continue; }
  noHls++;
  try {
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', '/app/data/originals/' + r.filename], { timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (bad.length < 8) bad.push(r.filename); // probe OK but no HLS = real failure
  } catch { corrupt++; }
}
console.log(JSON.stringify({ totalVideo: vids.length, hlsOk: ok, noHls, corruptAmongNoHls: corrupt, probeOkButNoHls: noHls - corrupt, sampleFailed: bad }));
