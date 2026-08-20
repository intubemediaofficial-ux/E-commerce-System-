export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: PageMeta;
  error?: ApiError;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.status = status;
    this.details = error.details;
  }
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const ACCESS_KEY = 'ims.accessToken';
const REFRESH_KEY = 'ims.refreshToken';

export const tokens = {
  access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  save(accessToken: string, refreshToken: string): void {
    window.localStorage.setItem(ACCESS_KEY, accessToken);
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  idempotencyKey?: string;
  auth?: boolean;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path.startsWith('http') ? path : `${API_URL}${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function rawRequest(path: string, options: RequestOptions, accessToken: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
}

async function refreshSession(): Promise<string | null> {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return null;
  const response = await fetch(buildUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    tokens.clear();
    return null;
  }
  const payload = (await response.json()) as ApiResponse<{
    accessToken: string;
    refreshToken: string;
  }>;
  tokens.save(payload.data.accessToken, payload.data.refreshToken);
  return payload.data.accessToken;
}

/**
 * Calls the API and unwraps the standard envelope. A 401 triggers a single
 * refresh-and-retry so long sessions survive access-token expiry.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  let response = await rawRequest(path, options, tokens.access());

  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshSession();
    if (refreshed) response = await rawRequest(path, options, refreshed);
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ApiResponse<T>) : ({ success: response.ok } as ApiResponse<T>);

  if (!response.ok || payload.success === false) {
    throw new ApiRequestError(
      response.status,
      payload.error ?? { code: 'REQUEST_FAILED', message: 'The request failed.' },
    );
  }
  return payload;
}

export async function get<T>(path: string, query?: Record<string, QueryValue>): Promise<ApiResponse<T>> {
  return request<T>(path, { query });
}

export async function post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await request<T>(path, { method: 'POST', body, idempotencyKey });
  return response.data;
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  const response = await request<T>(path, { method: 'PUT', body });
  return response.data;
}

export async function del<T>(path: string): Promise<T> {
  const response = await request<T>(path, { method: 'DELETE' });
  return response.data;
}

/** Opens a report/export download in a new tab with the bearer token attached. */
export async function download(path: string, query: Record<string, QueryValue>): Promise<void> {
  const response = await rawRequest(path, { query }, tokens.access());
  if (!response.ok) throw new ApiRequestError(response.status, { code: 'EXPORT_FAILED', message: 'Export failed.' });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (response.headers.get('content-disposition') ?? '').split('filename=')[1]?.replace(/"/g, '') ?? 'export';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
