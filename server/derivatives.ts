import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);
const FF_OPTS = { maxBuffer: 32 * 1024 * 1024 };
const DATA_DIR = path.resolve('data');
const DERIV_DIR = path.join(DATA_DIR, 'derivatives');

export const DERIVATIVE_WIDTHS = [640, 1280, 2048] as const;
export type DerivativeWidth = (typeof DERIVATIVE_WIDTHS)[number];

export function parseDerivativeWidth(raw: unknown): DerivativeWidth | null {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  return (DERIVATIVE_WIDTHS as readonly number[]).includes(n) ? (n as DerivativeWidth) : null;
}

// 같은 파일을 동시에 여러 번 요청해도 한 번만 생성한다 (갤러리 스크롤 시 다발 요청).
const inFlight = new Map<string, Promise<string | null>>();

// 갤러리 한 화면이면 파생본 요청이 수십 개가 동시에 들어온다.
// DS720+(Celeron)에서 4000px JPEG 리사이즈를 40개 동시에 돌리면 서버가 먹통이 되므로
// 실제 인코딩은 2개씩만 흘려보낸다. 대기는 순서대로, 캐시 적중은 이 게이트를 타지 않는다.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise(resolve => waiting.push(() => { running++; resolve(); }));
}

function release(): void {
  running--;
  waiting.shift()?.();
}

function derivPath(filename: string, width: number): string {
  return path.join(DERIV_DIR, `${filename}.${width}.webp`);
}

/**
 * 원본에서 width px WebP 파생본을 만들어 캐시하고 경로를 돌려준다.
 * - 캐시가 있으면 즉시 반환(재생성 안 함)
 * - 실패하면 null → 호출부가 기존 300px 썸네일로 폴백
 * - 원본은 읽기만 한다. 파생본은 항상 이 앱의 data/derivatives 아래에만 쓴다
 *   (구앱 데이터 디렉터리를 건드리지 않기 위함)
 */
export async function ensureDerivative(
  sourceDataDir: string,
  filename: string,
  type: 'image' | 'video',
  width: DerivativeWidth,
): Promise<string | null> {
  const out = derivPath(filename, width);
  if (fs.existsSync(out)) return out;

  const key = `${filename}:${width}`;
  const running = inFlight.get(key);
  if (running) return running;

  const job = (async (): Promise<string | null> => {
    const originalPath = path.join(sourceDataDir, 'originals', filename);
    if (!fs.existsSync(originalPath)) return null;

    fs.mkdirSync(DERIV_DIR, { recursive: true });
    const tmp = `${out}.${process.pid}.tmp`;
    const tmpFrame = `${tmp}.png`;
    const started = Date.now();
    await acquire();
    // 대기하는 동안 다른 요청이 이미 만들었을 수 있다
    if (fs.existsSync(out)) { release(); return out; }
    try {
      if (type === 'video') {
        await execFileAsync('ffmpeg', ['-y', '-i', originalPath, '-vframes', '1', '-vf', `scale=${width}:-2`, tmpFrame], FF_OPTS);
        await sharp(tmpFrame).webp({ quality: 82, effort: 4 }).toFile(tmp);
      } else {
        await sharp(originalPath)
          .rotate()
          .resize(width, width, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toFile(tmp);
      }
      fs.renameSync(tmp, out); // 원자적 교체 — 반쯤 쓰인 파일이 서빙되지 않게
      console.log(`[deriv] ${filename} @${width} 생성 ${Date.now() - started}ms`);
      return out;
    } catch (err) {
      console.warn(`[deriv] ${filename} @${width} 실패 → 300px 폴백:`, (err as Error).message);
      return null;
    } finally {
      release();
      fs.rmSync(tmp, { force: true });
      fs.rmSync(tmpFrame, { force: true });
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}
