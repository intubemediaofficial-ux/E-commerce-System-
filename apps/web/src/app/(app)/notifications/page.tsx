'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui';

interface NotificationsPayload {
  notifications: {
    id: string;
    type: string;
    title: string;
    message: string;
    readAt: string | null;
    createdAt: string;
  }[];
  unreadCount: number;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['/api/notifications'],
    queryFn: async () => (await get<NotificationsPayload>('/api/notifications', { perPage: 50 })).data,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
  };

  const markRead = useMutation({
    mutationFn: async (id: string) => post(`/api/notifications/${id}/read`, {}),
    onSuccess: invalidate,
  });

  const markAll = useMutation({
    mutationFn: async () => post('/api/notifications/read-all', {}),
    onSuccess: invalidate,
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`${query.data?.unreadCount ?? 0} unread alerts`}
        actions={
          <button
            type="button"
            className="btn-secondary"
            disabled={markAll.isPending || (query.data?.unreadCount ?? 0) === 0}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </button>
        }
      />

      {query.isPending ? (
        <Spinner />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (query.data?.notifications ?? []).length === 0 ? (
        <Card>
          <EmptyState message="No notifications yet." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {(query.data?.notifications ?? []).map((notification) => (
            <li key={notification.id}>
              <Card className={notification.readAt ? 'opacity-70' : ''}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge value={notification.type} />
                      <p className="text-sm font-semibold text-slate-800">{notification.title}</p>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                    <p className="mt-1 text-xs text-slate-400">{dateTime(notification.createdAt)}</p>
                  </div>
                  {notification.readAt ? null : (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => markRead.mutate(notification.id)}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
