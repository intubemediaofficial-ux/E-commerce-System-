import clsx from 'clsx';
import type { NavIcon } from '@/components/nav';

const PATHS: Record<NavIcon, string> = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-11h6V4h-6v5Z',
  catalogue: 'M4 7l8-4 8 4-8 4-8-4Zm0 5l8 4 8-4M4 17l8 4 8-4',
  inventory: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Zm2-4h14l2 4H3l2-4Zm4 8h6',
  purchasing: 'M3 4h2l2.4 11.2A2 2 0 0 0 9.36 17h8.28a2 2 0 0 0 1.96-1.6L21 8H6M9 21h.01M17 21h.01',
  restaurant: 'M6 3v8a3 3 0 0 0 6 0V3M9 11v10M17 3c-1.5 2-2 3.5-2 5s.5 3 2 3 2-1.5 2-3-.5-3-2-5Zm0 8v10',
  ecommerce: 'M4 6h16l-1.5 9.5A2 2 0 0 1 16.5 17h-9a2 2 0 0 1-2-1.5L4 6Zm4 0a4 4 0 0 1 8 0M9 21h.01M16 21h.01',
  insights: 'M4 20V10m5 10V4m5 16v-7m5 7V7',
  administration:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8.5 8.5 0 0 0-2-1.2L15.6 3h-3.9l-.4 2.5c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.4h3.9l.4-2.4c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
};

export function NavIconGlyph({ name, className }: { name: NavIcon; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={clsx('h-4 w-4', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      className={clsx('h-4 w-4', className)}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

export function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={clsx('h-4 w-4', className)}
    >
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={clsx('h-4 w-4', className)}
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.3 20a2 2 0 0 0 3.4 0" />
    </svg>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      className={clsx('h-5 w-5', className)}
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={clsx('h-4 w-4', className)}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
