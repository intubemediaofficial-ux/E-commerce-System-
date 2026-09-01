'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { del, post, put } from '@/lib/api';
import { useList, useListState } from '@/hooks/useList';
import { FieldErrors, fieldErrorsFromApi } from '@/lib/forms';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import {
  Badge,
  ColumnDef,
  ConfirmButton,
  DataTable,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';

export type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'email';

export interface FormFieldDef {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

export type FormValues = Record<string, string | boolean>;

export interface CrudPageProps<T extends { id: string }> {
  title: string;
  subtitle?: string;
  path: string;
  columns: ColumnDef<T>[];
  fields: FormFieldDef[];
  toFormValues?: (row: T) => FormValues;
  canManage: boolean;
  archivable?: boolean;
  emptyMessage?: string;
}

function coerce(fields: FormFieldDef[], values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === 'checkbox') {
      payload[field.name] = Boolean(value);
      continue;
    }
    if (value === '' || value === undefined) continue;
    payload[field.name] = field.type === 'number' ? Number(value) : value;
  }
  return payload;
}

/**
 * List + create/edit surface for the simple organization-scoped master data
 * resources that share the API's generic CRUD contract.
 */
export function CrudPage<T extends { id: string; status?: string }>({
  title,
  subtitle,
  path,
  columns,
  fields,
  toFormValues,
  canManage,
  archivable = true,
  emptyMessage,
}: CrudPageProps<T>) {
  const state = useListState();
  const list = useList<T>(path, state);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: [path] });
  };

  const setValue = (name: string, value: string | boolean): void => {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    for (const field of fields) {
      const value = values[field.name];
      if (field.required && (value === undefined || String(value).trim() === '')) {
        errors[field.name] = `${field.label} is required.`;
        continue;
      }
      if (field.type === 'number' && value !== undefined && String(value).trim() !== '') {
        if (Number.isNaN(Number(value))) errors[field.name] = `${field.label} must be a number.`;
      }
    }
    return errors;
  };

  const submit = (): void => {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(new Error('Please fix the highlighted fields before saving.'));
      return;
    }
    setError(null);
    save.mutate();
  };

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload = coerce(fields, values);
      if (editing) {
        await put(`${path}/${editing.id}`, payload);
      } else {
        await post(path, payload);
      }
    },
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setValues({});
      setError(null);
      setFieldErrors({});
      invalidate();
    },
    onError: (caught) => {
      setFieldErrors(fieldErrorsFromApi(caught, fields.map((field) => field.name)));
      setError(caught);
    },
  });

  const archive = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await del(`${path}/${id}`);
    },
    onSuccess: invalidate,
    onError: (caught) => setError(caught),
  });

  const restore = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await post(`${path}/${id}/restore`);
    },
    onSuccess: invalidate,
    onError: (caught) => setError(caught),
  });

  const startCreate = (): void => {
    setEditing(null);
    setValues({});
    setError(null);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (row: T): void => {
    setEditing(row);
    setValues(
      toFormValues
        ? toFormValues(row)
        : Object.fromEntries(
            fields.map((field) => {
              const raw = (row as unknown as Record<string, unknown>)[field.name];
              if (field.type === 'checkbox') return [field.name, Boolean(raw)];
              return [field.name, raw === null || raw === undefined ? '' : String(raw)];
            }),
          ),
    );
    setError(null);
    setFieldErrors({});
    setOpen(true);
  };

  const actionColumn: ColumnDef<T> = {
    header: 'Actions',
    align: 'right',
    cell: (row) => (
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => startEdit(row)}>
          Edit
        </button>
        {archivable && row.status !== 'ARCHIVED' ? (
          <ConfirmButton
            label="Archive"
            variant="danger"
            message={`Archive this record? It stays in history but is hidden from active lists.`}
            onConfirm={() => archive.mutate(row.id)}
          />
        ) : null}
        {archivable && row.status === 'ARCHIVED' ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={restore.isPending}
            onClick={() => restore.mutate(row.id)}
          >
            Unarchive
          </button>
        ) : null}
      </div>
    ),
  };

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={startCreate}>
              New
            </button>
          ) : null
        }
      />

      {error && !open ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch}>
          {archivable ? (
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
          ) : null}
        </Toolbar>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <>
            <DataTable
              columns={canManage ? [...columns, actionColumn] : columns}
              rows={list.rows}
              emptyMessage={emptyMessage ?? 'No records yet.'}
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
        title={editing ? `Edit ${title.replace(/s$/, '')}` : `New ${title.replace(/s$/, '')}`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending}
              onClick={submit}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <Field
                label={field.label}
                hint={field.hint}
                required={field.required}
                error={fieldErrors[field.name]}
              >
                {field.type === 'select' ? (
                  <select
                    className="input"
                    value={String(values[field.name] ?? '')}
                    onChange={(event) => setValue(field.name, event.target.value)}
                  >
                    <option value="">Select…</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    className="input"
                    rows={3}
                    value={String(values[field.name] ?? '')}
                    onChange={(event) => setValue(field.name, event.target.value)}
                  />
                ) : field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={Boolean(values[field.name])}
                    onChange={(event) => setValue(field.name, event.target.checked)}
                  />
                ) : (
                  <input
                    className="input"
                    type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
                    step={field.type === 'number' ? 'any' : undefined}
                    value={String(values[field.name] ?? '')}
                    onChange={(event) => setValue(field.name, event.target.value)}
                  />
                )}
              </Field>
            </div>
          ))}
        </div>
        {error ? (
          <div className="mt-3">
            <ErrorState error={error} />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

export function StatusCell({ value }: { value?: string }) {
  return value ? <Badge value={value} /> : <span className="text-slate-400">—</span>;
}
