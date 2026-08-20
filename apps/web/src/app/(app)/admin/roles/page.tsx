'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { del, get, post, put } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import {
  Badge,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Spinner,
} from '@/components/ui';

interface RoleRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

interface PermissionsPayload {
  catalog: Record<string, string>;
  permissions: { id: string; slug: string; module: string; description: string | null }[];
}

export default function RolesPage() {
  const { can } = useAuth();
  const canManage = can('role.manage');
  const queryClient = useQueryClient();

  const roles = useQuery({
    queryKey: ['/api/admin/roles'],
    queryFn: async () => (await get<RoleRow[]>('/api/admin/roles')).data,
    enabled: canManage,
  });

  const permissions = useQuery({
    queryKey: ['/api/admin/permissions'],
    queryFn: async () => (await get<PermissionsPayload>('/api/admin/permissions')).data,
    enabled: canManage,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/admin/roles'] });
  };

  const close = (): void => {
    setOpen(false);
    setEditing(null);
    setForm({ name: '', slug: '', description: '' });
    setSelected([]);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        permissions: selected,
      };
      if (editing) return put(`/api/admin/roles/${editing.id}`, payload);
      return post('/api/admin/roles', payload);
    },
    onSuccess: () => {
      close();
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => del(`/api/admin/roles/${id}`),
    onSuccess: invalidate,
    onError: setError,
  });

  if (!canManage) {
    return (
      <>
        <PageHeader title="Roles & permissions" />
        <Card>
          <EmptyState message="You do not have permission to manage roles." />
        </Card>
      </>
    );
  }

  const catalog = permissions.data?.catalog ?? {};
  const grouped = Object.entries(catalog).reduce<Record<string, string[]>>((acc, [slug, module]) => {
    acc[module] = [...(acc[module] ?? []), slug];
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Admin and Super Admin always retain full access"
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            New role
          </button>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      {roles.isPending ? (
        <Spinner />
      ) : roles.error ? (
        <ErrorState error={roles.error} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(roles.data ?? []).map((role) => (
            <Card key={role.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{role.name}</h2>
                  <p className="text-xs text-slate-400">
                    {role.slug} · {role.userCount} user(s)
                  </p>
                  {role.description ? (
                    <p className="mt-1 text-sm text-slate-600">{role.description}</p>
                  ) : null}
                </div>
                {role.isSystem ? <Badge value="SYSTEM" /> : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {role.permissions.slice(0, 12).map((permission) => (
                  <span
                    key={permission}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                  >
                    {permission}
                  </span>
                ))}
                {role.permissions.length > 12 ? (
                  <span className="text-xs text-slate-400">
                    +{role.permissions.length - 12} more
                  </span>
                ) : null}
              </div>

              {role.isSystem ? null : (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditing(role);
                      setForm({
                        name: role.name,
                        slug: role.slug,
                        description: role.description ?? '',
                      });
                      setSelected(role.permissions);
                      setOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  <ConfirmButton
                    label="Delete"
                    variant="danger"
                    message={`Delete role ${role.name}?`}
                    onConfirm={() => remove.mutate(role.id)}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : 'New role'}
        onClose={close}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending || !form.name || !form.slug || selected.length === 0}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save role'}
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
          <Field label="Slug" hint="lowercase letters, digits and underscores">
            <input
              className="input"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Description">
          <input
            className="input"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <div className="mt-4 space-y-4">
          {Object.entries(grouped).map(([module, slugs]) => (
            <div key={module}>
              <div className="flex items-center justify-between">
                <p className="label">{titleCase(module)}</p>
                <button
                  type="button"
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() =>
                    setSelected((current) =>
                      slugs.every((slug) => current.includes(slug))
                        ? current.filter((slug) => !slugs.includes(slug))
                        : Array.from(new Set([...current, ...slugs])),
                    )
                  }
                >
                  Toggle all
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {slugs.map((slug) => (
                  <label key={slug} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.includes(slug)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, slug]
                            : current.filter((value) => value !== slug),
                        )
                      }
                    />
                    {slug}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
