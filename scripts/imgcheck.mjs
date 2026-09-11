import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('/app/data/peanut-family.db', { readonly: true });
const imgs = db.prepare("SELECT filename FROM media WHERE type='image'").all();
let fileOk = 0, fileGone = 0, thumbOk = 0;
for (const r of imgs) {
  if (fs.existsSync('/app/data/originals/' + r.filename)) fileOk++; else fileGone++;
  if (fs.existsSync('/app/data/thumbnails/' + r.filename + '.webp')) thumbOk++;
}
fs.writeFileSync('/app/data/IMGCHECK.json', JSON.stringify({ images: imgs.length, fileOk, fileGone, thumbOk }));
