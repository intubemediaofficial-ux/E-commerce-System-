'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/components/ThemeProvider';
import { NAVIGATION } from '@/components/nav';
import { BellIcon, LogoutIcon, MenuIcon, MoonIcon, NavIconGlyph, SunIcon } from '@/components/icons';
import { Spinner } from '@/components/ui';
import { get } from '@/lib/api';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function UnreadBadge() {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const response = await get<{ unreadCount: number }>('/api/notifications', {
        perPage: 1,
        unreadOnly: true,
      });
      return response.data.unreadCount ?? 0;
    },
    refetchInterval: 60_000,
  });

  if (!data) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
      {data > 99 ? '99+' : data}
    </span>
  );
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

  const sections = NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);

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
            <p className="text-xs text-slate-500">Inventory control centre</p>
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="flex items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <NavIconGlyph name={section.icon} className="h-3.5 w-3.5" />
                {section.title}
              </p>
              <ul className="mt-2 space-y-0.5">
                {section.items.map((item) => {
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
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-4 py-3">
          <p className="text-[11px] text-slate-400">
            Ledger-backed inventory · every movement is audited
          </p>
        </div>
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
            <Link
              className="btn-secondary relative px-2"
              href="/notifications"
              aria-label="Notifications"
              title="Notifications"
            >
              <BellIcon />
              <UnreadBadge />
            </Link>
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
