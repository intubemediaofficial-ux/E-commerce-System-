'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/components/ThemeProvider';
import { NAVIGATION } from '@/components/nav';
import { LogoutIcon, MenuIcon, MoonIcon, SunIcon } from '@/components/icons';
import { Spinner } from '@/components/ui';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Preparing your workspace" />
      </div>
    );
  }

  const items = NAVIGATION.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="min-h-screen lg:flex">
      {menuOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-[var(--overlay)] lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        className={clsx(
          'z-40 flex flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:shrink-0',
          menuOpen
            ? 'fixed inset-y-0 left-0 w-72 max-w-[85vw] shadow-lifted'
            : 'hidden lg:flex',
        )}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-sm font-bold text-white shadow-soft">
            {initials(user.organizationName) || 'IM'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{user.organizationName}</p>
            <p className="text-xs text-slate-500">Product &amp; stock register</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={clsx(
                      'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition',
                      active
                        ? 'bg-brand-50 font-semibold text-brand-700 shadow-soft'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    <span
                      className={clsx(
                        'h-1.5 w-1.5 shrink-0 rounded-full transition',
                        active ? 'bg-brand-500' : 'bg-slate-300',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              className="btn-secondary px-2 lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MenuIcon />
            </button>
            <div className="hidden min-w-0 lg:block">
              <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.roles.join(' · ')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-2"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              onClick={toggle}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 sm:flex">
              {initials(user.name)}
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void logout()}
              title="Sign out"
            >
              <LogoutIcon />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
