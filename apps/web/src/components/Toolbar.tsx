'use client';

import { ReactNode } from 'react';

export function Toolbar({
  search,
  onSearch,
  children,
}: {
  search?: string;
  onSearch?: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-3">
      {onSearch ? (
        <input
          className="input max-w-xs"
          placeholder="Search…"
          value={search ?? ''}
          onChange={(event) => onSearch(event.target.value)}
        />
      ) : null}
      {children}
    </div>
  );
}

export function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <select
      className="input max-w-[200px]"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
