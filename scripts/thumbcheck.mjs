import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('/app/data/peanut-family.db', { readonly: true });
const rows = db.prepare("SELECT id, filename, type FROM media WHERE visibility='private' AND ownerId=1").all();
let miss = 0; const byExt = {}; const sample = [];
for (const r of rows) {
  if (!fs.existsSync('/app/data/thumbnails/' + r.filename + '.webp')) {
    miss++;
    const e = r.filename.split('.').pop().toLowerCase();
    byExt[e] = (byExt[e] || 0) + 1;
    if (sample.length < 5) sample.push({ id: r.id, fn: r.filename, type: r.type });
  }
}
console.log('private_total=' + rows.length);
console.log('thumb_missing=' + miss);
console.log('missing_by_ext=' + JSON.stringify(byExt));
console.log('sample=' + JSON.stringify(sample));
