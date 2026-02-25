import type { User } from '../api';

interface Props {
  user: User;
}

export default function Notes({ user }: Props) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>노트</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
        메모와 기록을 남기세요. (Phase 4에서 구현 예정)
      </p>
    </div>
  );
}
