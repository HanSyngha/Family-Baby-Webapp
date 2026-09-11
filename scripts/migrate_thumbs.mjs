// Immich 이관 [3단계: 컨테이너] — 썸네일 생성 (HLS 미생성). 자립형(sharp+ffmpeg 직접).
// docker cp scripts/migrate_thumbs.mjs <C>:/app/ && docker exec -w /app <C> node migrate_thumbs.mjs
import Database from 'better-sqlite3';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const FF = { maxBuffer: 1024 * 1024 * 64 };
const DATA = '/app/data';
// 병렬 샤딩: node migrate_thumbs.mjs <shard> <total>  (id % total == shard 만 처리)
const SHARD = parseInt(process.argv[2] ?? '0', 10);
const TOTAL = parseInt(process.argv[3] ?? '1', 10);
const db = new Database(path.join(DATA, 'peanut-family.db'));
db.pragma('busy_timeout = 30000');

const rows = db.prepare(`
  SELECT m.id, m.filename, m.type FROM media m
  JOIN migration_log l ON l.mediaId = m.id
  WHERE l.status = 'done' AND m.id % ? = ?`).all(TOTAL, SHARD);
console.log(`[thumbs shard ${SHARD}/${TOTAL}] candidates: ${rows.length}`);

const upd = db.prepare('UPDATE media SET width=COALESCE(width,?), height=COALESCE(height,?), duration=COALESCE(duration,?) WHERE id=?');

async function imageThumb(orig, thumb) {
  try {
    const meta = await sharp(orig).metadata();
    await sharp(orig).rotate().resize(300, 300, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumb);
    return { width: meta.width, height: meta.height };
  } catch {
    const tmp = thumb + '.tmp.jpg';
    try {
      await execFileAsync('ffmpeg', ['-i', orig, '-vframes', '1', '-vf', 'scale=300:-1', '-y', tmp], FF);
      await sharp(tmp).webp({ quality: 80 }).toFile(thumb);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return {};
  }
}

async function videoThumb(orig, thumb) {
  let w = null, h = null, dur = null;
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', orig], FF);
    const p = JSON.parse(stdout);
    const v = p.streams?.find(s => s.codec_type === 'video');
    if (v) { w = parseInt(v.width) || null; h = parseInt(v.height) || null; }
    if (p.format?.duration) dur = parseFloat(p.format.duration) || null;
  } catch {}
  const tmp = thumb + '.tmp.jpg';
  try {
    await execFileAsync('ffmpeg', ['-i', orig, '-vframes', '1', '-vf', 'scale=300:-1', '-y', tmp], FF);
    await sharp(tmp).webp({ quality: 80 }).toFile(thumb);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  return { width: w, height: h, duration: dur };
}

let done = 0, skip = 0, err = 0;
for (const r of rows) {
  const orig = path.join(DATA, 'originals', r.filename);
  const thumb = path.join(DATA, 'thumbnails', r.filename + '.webp');
  if (fs.existsSync(thumb)) { skip++; continue; }
  if (!fs.existsSync(orig)) { err++; continue; }
  try {
    const res = r.type === 'video' ? await videoThumb(orig, thumb) : await imageThumb(orig, thumb);
    if (res && (res.width || res.duration != null)) upd.run(res.width ?? null, res.height ?? null, res.duration ?? null, r.id);
    done++;
  } catch (e) {
    err++;
    if (err <= 15) console.error('[thumbs] fail', r.filename, String(e).slice(0, 140));
  }
  if ((done + skip + err) % 200 === 0) console.log(`[thumbs] ${done + skip + err}/${rows.length} done=${done} skip=${skip} err=${err}`);
}
console.log(`[thumbs] DONE done=${done} skip=${skip} err=${err} total=${rows.length}`);
db.close();
