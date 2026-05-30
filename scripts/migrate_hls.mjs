// 이관 영상 HLS 생성. h264=스트림복사, 그외=VAAPI HW 변환(1080p 다운스케일), 실패시 libx264, 손상=스킵.
//   node migrate_hls.mjs copy <shard> <total>   → h264만 스트림복사
//   node migrate_hls.mjs hevc <shard> <total>   → 비h264 VAAPI 변환(1080p)
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const FF = { maxBuffer: 1024 * 1024 * 64, timeout: 60 * 60 * 1000 };
const DATA = '/app/data';
const MODE = process.argv[2] || 'copy';
const SHARD = parseInt(process.argv[3] ?? '0', 10);
const TOTAL = parseInt(process.argv[4] ?? '1', 10);

const db = new Database(path.join(DATA, 'peanut-family.db'));
db.pragma('busy_timeout = 30000');
const rows = db.prepare(`
  SELECT m.id, m.filename FROM media m JOIN migration_log l ON l.mediaId = m.id
  WHERE l.status='done' AND m.type='video' AND m.id % ? = ?`).all(TOTAL, SHARD);
console.log(`[hls ${MODE} ${SHARD}/${TOTAL}] 후보 영상: ${rows.length}`);

function codecOf(p) {
  try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', p], { maxBuffer: 1 << 20, timeout: 20000 }).toString().trim().split(',')[0]; }
  catch { return null; }
}
const HLS = ['-hls_time', '4', '-hls_list_size', '0', '-hls_segment_type', 'fmp4', '-hls_segment_filename', 'seg%03d.m4s', '-y', 'playlist.m3u8'];
// 긴 변 1920 박스로 다운스케일(짝수 강제 — VAAPI 4096 한계 회피 + 홀수해상도 거부 회피).
// 가로/세로 모두 대응: 긴 변을 1920로, 짧은 변은 비율 유지 후 짝수 trunc.
const SCALE_VAAPI = "scale_vaapi=w='if(gt(iw,ih),min(1920,iw),trunc(iw*min(1920,ih)/ih/2)*2)':h='if(gt(iw,ih),trunc(ih*min(1920,iw)/iw/2)*2,min(1920,ih))':format=nv12";
const SCALE_SW = "scale='if(gt(iw,ih),min(1920,iw),trunc(iw*min(1920,ih)/ih/2)*2)':'if(gt(iw,ih),trunc(ih*min(1920,iw)/iw/2)*2,min(1920,ih))'";

async function copyHls(orig, dir) {
  await execFileAsync('ffmpeg', ['-loglevel', 'error', '-nostats', '-i', orig, '-c', 'copy', ...HLS], { cwd: dir, ...FF });
}
async function vaapiHls(orig, dir) {
  await execFileAsync('ffmpeg', ['-loglevel', 'error', '-nostats',
    '-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128', '-hwaccel_output_format', 'vaapi',
    '-i', orig, '-vf', SCALE_VAAPI, '-c:v', 'h264_vaapi', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', ...HLS], { cwd: dir, ...FF });
}
async function x264Hls(orig, dir) {
  await execFileAsync('ffmpeg', ['-loglevel', 'error', '-nostats', '-i', orig,
    '-vf', SCALE_SW, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', ...HLS], { cwd: dir, ...FF });
}

let ok = 0, sw = 0, corrupt = 0, skip = 0, err = 0, notmine = 0;
for (const r of rows) {
  const orig = path.join(DATA, 'originals', r.filename);
  const dir = path.join(DATA, 'hls', r.filename);
  if (fs.existsSync(path.join(dir, 'playlist.m3u8'))) { skip++; continue; }
  if (!fs.existsSync(orig)) { err++; continue; }
  const c = codecOf(orig);
  if (!c) { corrupt++; continue; }
  if (MODE === 'copy' && c !== 'h264') { notmine++; continue; }
  if (MODE === 'hevc' && c === 'h264') { notmine++; continue; }
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (c === 'h264') { await copyHls(orig, dir); ok++; }
    else { try { await vaapiHls(orig, dir); ok++; } catch { await x264Hls(orig, dir); sw++; } }
  } catch (e) {
    err++; try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    if (err <= 8) console.error('[hls] fail', r.filename, String(e).slice(0, 100));
  }
  const done = ok + sw + corrupt + err;
  if (done % 25 === 0) console.log(`[hls ${MODE} ${SHARD}] ok=${ok} sw=${sw} corrupt=${corrupt} err=${err} skip=${skip}`);
}
console.log(`[hls ${MODE} ${SHARD}] DONE ok=${ok} sw=${sw} corrupt=${corrupt} err=${err} skip=${skip} notmine=${notmine}`);
db.close();
