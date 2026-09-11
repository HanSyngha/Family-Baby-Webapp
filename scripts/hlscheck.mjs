import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('/app/data/peanut-family.db', { readonly: true });
const v = db.prepare("SELECT m.filename FROM media m JOIN migration_log l ON l.mediaId = m.id WHERE l.status = 'done' AND m.type = 'video'").all();
let done = 0, todo = 0;
for (const r of v) {
  if (fs.existsSync('/app/data/hls/' + r.filename + '/playlist.m3u8')) done++; else todo++;
}
console.log(JSON.stringify({ totalVideos: v.length, hlsDone: done, todo }));
