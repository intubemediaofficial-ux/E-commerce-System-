'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { del, get, post, put } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { fieldErrorsFromApi, requiredText, type FieldErrors } from '@/lib/forms';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { Toolbar } from '@/components/Toolbar';
import {
  Badge,
  ConfirmButton,
  DataTable,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';
import type { ManagedRole, ManagedUser } from '@/lib/types';

interface FormState {
  name: string;
  email: string;
  phone: string;
  password: string;
  roleId: string;
}

const EMPTY: FormState = { name: '', email: '', phone: '', password: '', roleId: '' };
const FIELDS = ['name', 'email', 'phone', 'password', 'roleId'];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const state = useListState();
  const list = useList<ManagedUser>('/api/admin/users', state);
  const roles = useQuery({
    queryKey: ['/api/admin/roles'],
    queryFn: async () => (await get<ManagedRole[]>('/api/admin/roles')).data,
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);

  const refresh = (): void => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
  };

  const create = useMutation({
    mutationFn: async (payload: FormState) =>
      post('/api/admin/users', {
        name: payload.name.trim(),
        email: payload.email.trim(),
        phone: payload.phone.trim() || undefined,
        password: payload.password,
        roleIds: [payload.roleId],
      }),
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY);
      setErrors({});
      refresh();
    },
    onError: (err) => {
      setErrors(fieldErrorsFromApi(err, FIELDS));
      setError(err);
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      put(`/api/admin/users/${id}`, { status }),
    onSuccess: refresh,
    onError: setError,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => del(`/api/admin/users/${id}`),
    onSuccess: refresh,
    onError: setError,
  });

  const resetPassword = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) =>
      post(`/api/admin/users/${id}/password`, { password }),
    onSuccess: refresh,
    onError: setError,
  });

  const submit = (): void => {
    const next: FieldErrors = {};
    const name = requiredText(form.name, 'Name');
    if (name) next.name = name;
    if (!form.email.trim()) next.email = 'Email is required.';
    if (form.password.length < 10) next.password = 'Password must be at least 10 characters.';
    if (!form.roleId) next.roleId = 'Select a role.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate(form);
  };

  const askPassword = (user: ManagedUser): void => {
    const password = window.prompt(`New password for ${user.email} (min 10 characters)`);
    if (!password) return;
    if (password.length < 10) {
      setError(new Error('Password must be at least 10 characters.'));
      return;
    }
    resetPassword.mutate({ id: user.id, password });
  };

  return (
    <>
      <PageHeader
        title="User Management"
        subtitle="Give your team their own login and access level"
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setForm(EMPTY);
              setErrors({});
              setOpen(true);
            }}
          >
            + Add User
          </button>
        }
      />

      {error ? (
        <div className="mb-3">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch} />
        {list.isLoading ? (
          <div className="p-6">
            <Spinner label="Loading users" />
          </div>
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <DataTable<ManagedUser>
            rows={list.rows}
            emptyMessage="No users yet."
            columns={[
              {
                header: 'Name',
                cell: (row) => <span className="font-medium text-slate-800">{row.name}</span>,
              },
              { header: 'Email', cell: (row) => row.email },
              {
                header: 'Access',
                cell: (row) => row.userRoles.map((entry) => entry.role.name).join(', ') || '—',
              },
              { header: 'Status', cell: (row) => <Badge value={row.status} /> },
              { header: 'Last login', cell: (row) => dateTime(row.lastLoginAt) },
              {
                header: 'Actions',
                align: 'right',
                cell: (row) => (
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary" onClick={() => askPassword(row)}>
                      Reset password
                    </button>
                    {row.id === currentUser?.id ? null : (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            setStatus.mutate({
                              id: row.id,
                              status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                            })
                          }
                        >
                          {row.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                        <ConfirmButton
                          label="Remove"
                          variant="danger"
                          message={`Remove ${row.email}? They will no longer be able to log in.`}
                          onConfirm={() => archive.mutate(row.id)}
                        />
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
        <Pagination
          page={list.meta.page}
          totalPages={list.meta.totalPages}
          total={list.meta.total}
          onChange={state.setPage}
        />
      </div>

      <Modal
        open={open}
        title="Add User"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending}
              onClick={submit}
            >
              {create.isPending ? 'Saving…' : 'Save User'}
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Email" required error={errors.email}>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input
              className="input"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
          <Field
            label="Password"
            required
            error={errors.password}
            hint="At least 10 characters. Share it with the user."
          >
            <input
              className="input"
              type="text"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </Field>
          <Field
            label="Access level"
            required
            error={errors.roleId}
            hint="Admin gets full access to everything."
          >
            <select
              className="input"
              value={form.roleId}
              onChange={(event) => setForm({ ...form, roleId: event.target.value })}
            >
              <option value="">Select a role…</option>
              {(roles.data ?? []).map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
