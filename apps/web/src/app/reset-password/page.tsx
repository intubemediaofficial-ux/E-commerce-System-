'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import { ErrorState, Field } from '@/components/ui';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      await post('/api/auth/reset-password', { token, password });
      router.replace('/login');
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-lg font-semibold text-slate-900">Set a new password</h1>
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <Field label="Reset token">
            <input
              className="input"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          <Field
            label="New password"
            hint="At least 10 characters with upper case, lower case and a digit."
          >
            <input
              className="input"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error ? <ErrorState error={error} /> : null}
          <button className="btn-primary w-full" type="submit">
            Update password
          </button>
        </form>
        <Link className="mt-4 inline-block text-sm text-brand-600 hover:underline" href="/login">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
