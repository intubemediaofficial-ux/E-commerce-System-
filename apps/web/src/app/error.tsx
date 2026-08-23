'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-lg p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-rose-600">Error</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">This page could not be rendered</h1>
        <p className="mt-2 break-words text-sm text-slate-500">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={reset}>
            Try again
          </button>
          <a className="btn-secondary" href="/dashboard">
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
