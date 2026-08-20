'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { del, get, post, put } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import {
  Badge,
  Card,
  ConfirmButton,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';

interface RoleRow {
  id: string;
  name: string;
  slug: string;
  permissions: string[];
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  userRoles: { role: { id: string; slug: string; name: string } }[];
}

const EMPTY_FORM = { name: '', email: '', phone: '', password: '', status: 'ACTIVE' };

export default function UsersPage() {
  const { can } = useAuth();
  const canManage = can('user.manage');
  const state = useListState();
  const list = useList<UserRow>('/api/admin/users', state);
  const queryClient = useQueryClient();

  const roles = useQuery({
    queryKey: ['/api/admin/roles'],
    queryFn: async () => (await get<RoleRow[]>('/api/admin/roles')).data,
    enabled: canManage,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [passwordFor, setPasswordFor] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
  };

  const close = (): void => {
    setOpen(false);
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setRoleIds([]);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        status: form.status,
        roleIds,
      };
      if (editing) return put(`/api/admin/users/${editing.id}`, payload);
      return post('/api/admin/users', { ...payload, password: form.password });
    },
    onSuccess: () => {
      close();
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const resetPassword = useMutation({
    mutationFn: async () => post(`/api/admin/users/${passwordFor?.id}/password`, { password: newPassword }),
    onSuccess: () => {
      setPasswordFor(null);
      setNewPassword('');
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => del(`/api/admin/users/${id}`),
    onSuccess: invalidate,
    onError: setError,
  });

  if (!canManage) {
    return (
      <>
        <PageHeader title="Users" />
        <Card>
          <EmptyState message="You do not have permission to manage users." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Create team members, assign roles and reset credentials"
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setForm({ ...EMPTY_FORM });
              setRoleIds([]);
              setOpen(true);
            }}
          >
            New user
          </button>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch}>
          <SelectFilter
            label="All statuses"
            value={state.filters.status as string | undefined}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
            onChange={(value) => state.setFilter('status', value)}
          />
        </Toolbar>

        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <>
            <DataTable<UserRow>
              rows={list.rows}
              emptyMessage="No users found."
              columns={[
                { header: 'Name', cell: (row) => row.name },
                { header: 'Email', cell: (row) => row.email },
                {
                  header: 'Roles',
                  cell: (row) => (
                    <div className="flex flex-wrap gap-1">
                      {row.userRoles.map((userRole) => (
                        <Badge key={userRole.role.id} value={userRole.role.name} />
                      ))}
                    </div>
                  ),
                },
                { header: 'Last login', cell: (row) => dateTime(row.lastLoginAt) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) => (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setEditing(row);
                          setForm({
                            name: row.name,
                            email: row.email,
                            phone: row.phone ?? '',
                            password: '',
                            status: row.status,
                          });
                          setRoleIds(row.userRoles.map((userRole) => userRole.role.id));
                          setOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setPasswordFor(row);
                          setNewPassword('');
                        }}
                      >
                        Reset password
                      </button>
                      {row.status === 'ARCHIVED' ? null : (
                        <ConfirmButton
                          label="Archive"
                          variant="danger"
                          message={`Archive ${row.name}? Their sessions are revoked.`}
                          onConfirm={() => archive.mutate(row.id)}
                        />
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination
              page={list.meta.page}
              totalPages={list.meta.totalPages}
              total={list.meta.total}
              onChange={state.setPage}
            />
          </>
        )}
      </div>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : 'New user'}
        onClose={close}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending || !form.name || !form.email || roleIds.length === 0}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save user'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </Field>
          {editing ? null : (
            <Field label="Temporary password" hint="At least 10 characters">
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </Field>
          )}
        </div>

        <div className="mt-4">
          <span className="label">Roles</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {(roles.data ?? []).map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={roleIds.includes(role.id)}
                  onChange={(event) =>
                    setRoleIds((current) =>
                      event.target.checked
                        ? [...current, role.id]
                        : current.filter((id) => id !== role.id),
                    )
                  }
                />
                {role.name}
                <span className="text-xs text-slate-400">({role.permissions.length} perms)</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(passwordFor)}
        title={`Reset password · ${passwordFor?.name ?? ''}`}
        onClose={() => setPasswordFor(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPasswordFor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={resetPassword.isPending || newPassword.length < 10}
              onClick={() => resetPassword.mutate()}
            >
              {resetPassword.isPending ? 'Saving…' : 'Set password'}
            </button>
          </>
        }
      >
        <Field label="New password" hint="At least 10 characters. All sessions are revoked.">
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
