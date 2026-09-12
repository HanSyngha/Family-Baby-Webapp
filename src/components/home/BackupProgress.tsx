import { useEffect, useState } from 'react';
import { api } from '../../api';
import { isNativeApp, backup } from '../../lib/backup';
import Icon from '../ui/Icon';
import styles from './BackupProgress.module.css';

interface Progress {
  photoTotal: number;
  photoDone: number;
  videoTotal: number;
  videoDone: number;
  sweepDone?: boolean;
  deviceName?: string;
  updatedAt?: string;
}

/**
 * 2% 단위로 바뀌는 막대 색.
 *
 * 연속 그라데이션이 아니라 계단식인 이유: 99%와 100%가 같은 색으로 보이면 '다 됐나?'를
 * 눈으로 구분할 수 없다. 2%마다 색이 확실히 달라지면 조금씩 차오르는 게 보인다.
 * 빨강(0%) → 주황 → 노랑 → 초록(100%)으로, 색 자체가 안심의 정도를 말하게 한다.
 */
function barColor(pct: number): string {
  const step = Math.min(100, Math.max(0, Math.floor(pct / 2) * 2));
  const hue = 4 + (step / 100) * 138;      // 4°(빨강) → 142°(초록)
  const sat = 62 + (step / 100) * 8;
  const light = 46 - (step / 100) * 6;     // 초록 쪽이 너무 밝아 보이지 않게 살짝 어둡게
  return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
}

function pctOf(done: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, (done / total) * 100);
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function Bar({ label, icon, done, total }: { label: string; icon: 'camera' | 'ticket'; done: number; total: number }) {
  const pct = pctOf(done, total);
  // 표시 숫자도 막대와 같은 2% 계단을 쓴다. 막대는 그대로인데 숫자만 바뀌면 어긋나 보인다.
  const shown = Math.floor(pct / 2) * 2;
  const complete = total > 0 && done >= total;

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowLabel}>
          <Icon name={icon} size={15} />
          {label}
        </span>
        <span className={styles.rowCount}>
          {fmt(done)}<span className={styles.slash}> / </span>{fmt(total)}
          <strong className={styles.pct} style={{ color: barColor(pct) }}>
            {complete ? 100 : shown}%
          </strong>
        </span>
      </div>
      <div className={styles.track} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div
          className={`${styles.fill} ${complete ? styles.fillComplete : ''}`}
          style={{ width: `${Math.max(pct, total > 0 && done > 0 ? 2 : 0)}%`, background: barColor(pct) }}
        />
      </div>
    </div>
  );
}

/**
 * 폰 원본이 서버에 실제로 있는지 보여주는 막대.
 *
 * '올렸다고 기록했다'가 아니라 '해시로 물어봐서 서버에 있다고 확인됐다'를 센다.
 * 분모(폰에 있는 장수)는 서버가 알 수 없어 안드로이드 앱이 보고한 값을 쓴다.
 * 앱 안에서 열면 플러그인에서 직접 읽어 더 최신 값을 보여준다.
 */
export default function BackupProgress() {
  const [p, setP] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      // 1) 앱 안이면 플러그인에서 바로 (지금 이 순간의 숫자)
      if (isNativeApp) {
        try {
          const live = await backup.getBackupProgress();
          if (alive && live && (live.photoTotal > 0 || live.videoTotal > 0)) {
            setP(live);
            return;
          }
        } catch { /* 아래 서버 값으로 폴백 */ }
      }
      // 2) 웹이면 앱이 마지막으로 보고한 값
      try {
        const d = await api.getBackupProgress();
        if (alive && d.reported) setP(d as unknown as Progress);
      } catch { /* 조용히 */ }
    };

    load().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 앱이 한 번도 보고한 적 없으면 아무것도 보여주지 않는다.
  // 빈 막대를 띄우면 '백업이 안 됐다'는 오해를 준다.
  if (loading || !p) return null;
  if (p.photoTotal <= 0 && p.videoTotal <= 0) return null;

  const allDone = p.photoDone >= p.photoTotal && p.videoDone >= p.videoTotal;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>
          <Icon name="lock" size={16} className={styles.titleIcon} />
          원본 백업
        </span>
        {allDone
          ? <span className={styles.badgeDone}>전부 백업됨</span>
          : p.sweepDone === false
            ? <span className={styles.badgeChecking}>확인 중</span>
            : null}
      </div>

      <Bar label="사진" icon="camera" done={p.photoDone} total={p.photoTotal} />
      {p.videoTotal > 0 && <Bar label="영상" icon="ticket" done={p.videoDone} total={p.videoTotal} />}

      <p className={styles.note}>
        {p.sweepDone === false
          ? '폰에 있던 사진을 서버와 하나씩 대조하는 중이에요. 다 확인되면 숫자가 올라갑니다.'
          : '폰의 원본과 서버를 대조해 실제로 있는 것만 셉니다.'}
      </p>
    </div>
  );
}
