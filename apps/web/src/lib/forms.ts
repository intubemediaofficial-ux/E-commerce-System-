import { ApiRequestError } from '@/lib/api';

export type FieldErrors = Record<string, string>;

interface ValidationDetail {
  path: string;
  message: string;
}

function isDetailArray(value: unknown): value is ValidationDetail[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ValidationDetail).path === 'string' &&
        typeof (entry as ValidationDetail).message === 'string',
    )
  );
}

/**
 * Turns an API failure into per-field messages so forms can highlight the
 * offending input instead of only showing a banner. `known` limits the mapping
 * to fields the form actually renders; anything else stays form level.
 */
export function fieldErrorsFromApi(error: unknown, known: string[]): FieldErrors {
  if (!(error instanceof ApiRequestError)) return {};
  const errors: FieldErrors = {};

  if (isDetailArray(error.details)) {
    for (const detail of error.details) {
      const field = detail.path.split('.').find((part) => known.includes(part));
      if (field && !errors[field]) errors[field] = detail.message;
    }
  }

  if (error.status === 409) {
    const field = known.find((name) => error.message.toLowerCase().includes(name.toLowerCase()));
    if (field) errors[field] = error.message;
  }

  return errors;
}

/** True when the API failure was fully explained by field-level messages. */
export function isFieldOnlyError(error: unknown, fieldErrors: FieldErrors): boolean {
  return error instanceof ApiRequestError && Object.keys(fieldErrors).length > 0;
}

export function requiredText(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required.`;
}

export function requiredNumber(value: string, label: string): string | null {
  if (!value.trim()) return `${label} is required.`;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return `${label} must be a number.`;
  if (parsed < 0) return `${label} cannot be negative.`;
  return null;
}
