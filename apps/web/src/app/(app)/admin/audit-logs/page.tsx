'use client';

import { dateTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { Toolbar } from '@/components/Toolbar';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';

interface AuditRow {
  id: string;
  action: string;
  module: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

export default function AuditLogsPage() {
  const { can } = useAuth();
  const state = useListState();
  const list = useList<AuditRow>('/api/admin/audit-logs', state);

  if (!can('audit.view')) {
    return (
      <>
        <PageHeader title="Audit logs" />
        <Card>
          <EmptyState message="You do not have permission to view audit logs." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Audit logs" subtitle="Immutable record of every sensitive operation" />

      <div className="card">
        <Toolbar>
          <input
            className="input max-w-[200px]"
            placeholder="Action"
            value={(state.filters.action as string | undefined) ?? ''}
            onChange={(event) => state.setFilter('action', event.target.value || undefined)}
          />
          <input
            className="input max-w-[200px]"
            placeholder="Module"
            value={(state.filters.module as string | undefined) ?? ''}
            onChange={(event) => state.setFilter('module', event.target.value || undefined)}
          />
          <input
            className="input max-w-[200px]"
            placeholder="Entity type"
            value={(state.filters.entityType as string | undefined) ?? ''}
            onChange={(event) => state.setFilter('entityType', event.target.value || undefined)}
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
            <DataTable<AuditRow>
              rows={list.rows}
              emptyMessage="No audit entries for these filters."
              columns={[
                { header: 'When', cell: (row) => dateTime(row.createdAt) },
                { header: 'Action', cell: (row) => <Badge value={row.action} /> },
                { header: 'Module', cell: (row) => row.module },
                {
                  header: 'Entity',
                  cell: (row) => (
                    <span className="text-xs text-slate-500">
                      {row.entityType ?? '—'}
                      {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ''}
                    </span>
                  ),
                },
                { header: 'User', cell: (row) => row.user?.name ?? 'System' },
                { header: 'IP', cell: (row) => row.ip ?? '—' },
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
    </>
  );
}
