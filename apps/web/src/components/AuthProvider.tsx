'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, tokens } from '@/lib/api';
import type { AuthUser, LoginResult } from '@/lib/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const FULL_ACCESS_ROLES = ['super_admin', 'admin'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async (): Promise<void> => {
      if (!tokens.access()) {
        setLoading(false);
        return;
      }
      try {
        const response = await get<AuthUser>('/api/auth/me');
        if (!cancelled) setUser(response.data);
      } catch {
        tokens.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const result = await post<LoginResult>('/api/auth/login', { email, password });
      tokens.save(result.accessToken, result.refreshToken);
      setUser(result.user);
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = tokens.refresh();
    try {
      await post('/api/auth/logout', refreshToken ? { refreshToken } : {});
    } finally {
      tokens.clear();
      setUser(null);
      router.replace('/login');
    }
  }, [router]);

  const can = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      if (user.roles.some((role) => FULL_ACCESS_ROLES.includes(role))) return true;
      return user.permissions.includes(permission);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, can }),
    [user, loading, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
