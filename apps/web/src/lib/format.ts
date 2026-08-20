const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export const money = (value: string | number | null | undefined): string =>
  currency.format(Number(value ?? 0));

export const qty = (value: string | number | null | undefined): string => {
  const numeric = Number(value ?? 0);
  return Number.isInteger(numeric) ? numeric.toString() : numeric.toFixed(3).replace(/0+$/, '');
};

export const dateTime = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const dateOnly = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';

export const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
