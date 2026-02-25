import type { User } from '../api';

interface Props {
  user: User;
  onLogout: () => void;
}

export default function Settings({ user, onLogout }: Props) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>설정</h2>

      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius)',
        padding: 20,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user.profileImage ? (
            <img src={user.profileImage} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 600,
            }}>
              {user.name[0]}
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{user.name}</div>
            <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{user.role}</div>
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius)',
        padding: 20,
        marginBottom: 16,
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>LLM 설정</h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
          Phase 5에서 구현 예정
        </p>
      </div>

      {/* Mobile only logout */}
      <button
        onClick={onLogout}
        className="mobile-only"
        style={{
          width: '100%',
          padding: 14,
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius)',
          color: 'var(--color-danger)',
          fontSize: 15,
          fontWeight: 600,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
