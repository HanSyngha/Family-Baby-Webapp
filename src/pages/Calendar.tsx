import type { User } from '../api';

interface Props {
  user: User;
}

export default function Calendar({ user }: Props) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>캘린더</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
        가족 일정을 공유하세요. (Phase 2에서 구현 예정)
      </p>
    </div>
  );
}
