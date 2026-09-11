import { useState, useEffect, useCallback } from 'react';
import { api, type User } from '../api';
import { clearBackupAuth, syncBackupAuth } from '../lib/backup';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMe()
      .then((u) => {
        setUser(u);
        syncBackupAuth(u);
      })
      .catch((err) => {
        setUser(null);
        if (err instanceof Error && err.message === 'Unauthorized') clearBackupAuth();
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await clearBackupAuth();
    await api.logout();
    setUser(null);
  }, []);

  return { user, loading, logout };
}
