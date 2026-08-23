'use client';

import clsx from 'clsx';
import { ReactNode } from 'react';

const TONES = {
  default: {
    value: 'text-slate-900',
    accent: 'from-brand-500 to-brand-300',
  },
  warning: { value: 'text-amber-600', accent: 'from-amber-500 to-amber-300' },
  danger: { value: 'text-rose-600', accent: 'from-rose-500 to-rose-300' },
  success: { value: 'text-emerald-600', accent: 'from-emerald-500 to-emerald-300' },
} as const;

export type Tone = keyof typeof TONES;

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('card p-4', className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="card relative overflow-hidden p-4 transition hover:shadow-lifted">
      <span
        className={clsx(
          'absolute inset-x-0 top-0 h-1 bg-gradient-to-r',
          TONES[tone].accent,
        )}
      />
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={clsx('mt-2 text-2xl font-bold tracking-tight', TONES[tone].value)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  IN_STOCK: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  FULLY_RECEIVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  LOW_STOCK: 'bg-amber-50 text-amber-700 ring-amber-200',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 ring-amber-200',
  PARTIALLY_RECEIVED: 'bg-amber-50 text-amber-700 ring-amber-200',
  EXPIRING: 'bg-amber-50 text-amber-700 ring-amber-200',
  OUT_OF_STOCK: 'bg-rose-50 text-rose-700 ring-rose-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
  EXPIRED: 'bg-rose-50 text-rose-700 ring-rose-200',
  ARCHIVED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function Badge({ value }: { value: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[value] ?? 'bg-brand-50 text-brand-700 ring-brand-100',
      )}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-6 w-6"
        >
          <path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Zm2-4h14l2 4H3l2-4Zm4 8h6" />
        </svg>
      </span>
      <p className="text-sm font-medium text-slate-500">{message}</p>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}…
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5m0 3h.01" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[var(--overlay)] p-4 sm:items-center">
      <div className="card w-full max-w-2xl shadow-lifted">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmButton({
  label,
  message,
  onConfirm,
  variant = 'secondary',
  disabled,
}: {
  label: string;
  message: string;
  onConfirm: () => void;
  variant?: 'secondary' | 'danger' | 'primary';
  disabled?: boolean;
}) {
  const className =
    variant === 'danger' ? 'btn-danger' : variant === 'primary' ? 'btn-primary' : 'btn-secondary';
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
    >
      {label}
    </button>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm text-slate-500">
      <span>
        Page {page} of {Math.max(totalPages, 1)} · {total} records
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function rowId<T>(row: T, index: number): string {
  const candidate = (row as { id?: unknown }).id;
  return typeof candidate === 'string' ? candidate : String(index);
}

export interface ColumnDef<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function DataTable<T>({
  columns,
  rows,
  emptyMessage = 'Nothing to show yet.',
  rowKey,
}: {
  columns: ColumnDef<T>[];
  rows: T[];
  emptyMessage?: string;
  rowKey?: (row: T, index: number) => string;
}) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                className={clsx(
                  'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500',
                  column.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row, index) : rowId(row, index)}
              className="transition hover:bg-brand-50"
            >
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={clsx('table-cell', column.align === 'right' && 'text-right')}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
