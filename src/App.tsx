import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import AppShell from './components/layout/AppShell';

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100dvh',
        gap: 16,
        background: 'var(--color-bg)',
      }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{
          fontSize: 15,
          color: 'var(--color-text-secondary)',
          fontWeight: 500,
        }}>
          불러오는 중...
        </span>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/*" element={user ? <AppShell user={user} onLogout={logout} /> : <Navigate to="/login" />} />
    </Routes>
  );
}
