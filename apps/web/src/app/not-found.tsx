import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you opened does not exist or has been moved.
        </p>
        <Link className="btn-primary mt-5 inline-flex" href="/dashboard">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
