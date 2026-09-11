import { useEffect, useState } from 'react';
import { backup, isNativeApp, type UpdateInfo } from '../lib/backup';
import s from './UpdateBanner.module.css';

/** 네이티브 앱에서 새 버전이 있으면 상단에 "업데이트 있음" 배너 표시(윈도우식). */
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!isNativeApp) return;
    backup.checkUpdate()
      .then((r) => { if (r.available) setInfo(r); })
      .catch(() => { /* ignore */ });
  }, []);

  if (!info || dismissed || !info.url) return null;

  // 자동설치 권한(REQUEST_INSTALL_PACKAGES)을 제거(보안앱 오탐 방지)했으므로
  // 외부 브라우저로 APK를 받아 사용자가 직접 설치한다.
  const onUpdate = () => {
    const url = info.url!.startsWith('http') ? info.url! : window.location.origin + info.url!;
    window.open(url, '_system');
  };

  return (
    <div className={s.banner}>
      <div className={s.text}>
        <div className={s.title}>새 버전이 있어요{info.versionName ? ` (${info.versionName})` : ''}</div>
        {info.notes ? <div className={s.notes}>{info.notes}</div> : null}
      </div>
      <button className={s.btn} onClick={onUpdate}>받기</button>
      <button className={s.close} onClick={() => setDismissed(true)} aria-label="닫기">✕</button>
    </div>
  );
}
