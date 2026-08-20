'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import { ErrorState, Field } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      await post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-lg font-semibold text-slate-900">Reset your password</h1>
        {sent ? (
          <p className="mt-3 text-sm text-slate-600">
            If the account exists, a reset token has been emailed. Continue on the{' '}
            <Link className="text-brand-600 hover:underline" href="/reset-password">
              reset page
            </Link>
            .
          </p>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <Field label="Email">
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {error ? <ErrorState error={error} /> : null}
            <button className="btn-primary w-full" type="submit">
              Send reset token
            </button>
          </form>
        )}
        <Link className="mt-4 inline-block text-sm text-brand-600 hover:underline" href="/login">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
