import type { User } from '../api';

interface Props {
  user: User;
}

export default function Gallery({ user }: Props) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>갤러리</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
        사진과 영상을 공유하세요. (Phase 1에서 구현 예정)
      </p>
    </div>
  );
}
