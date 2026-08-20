'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, put } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { Card, EmptyState, ErrorState, Field, PageHeader, Spinner } from '@/components/ui';

interface Organization {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  currency: string;
  _count: { users: number; warehouses: number; products: number };
}

interface Settings {
  allowNegativeStock: boolean;
  valuationMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
  useFefoForPerishables: boolean;
  allowExpiredConsumption: boolean;
  reservationTtlMinutes: number;
  adjustmentApprovalValue: string;
  notifyByEmail: boolean;
  notifyInApp: boolean;
}

export default function SettingsPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');
  const queryClient = useQueryClient();

  const organization = useQuery({
    queryKey: ['/api/admin/organization'],
    queryFn: async () => (await get<Organization>('/api/admin/organization')).data,
    enabled: canManage,
  });

  const settings = useQuery({
    queryKey: ['/api/admin/settings'],
    queryFn: async () => (await get<Settings>('/api/admin/settings')).data,
    enabled: canManage,
  });

  const [org, setOrg] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    taxNumber: '',
    currency: 'INR',
  });
  const [config, setConfig] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (organization.data) {
      setOrg({
        name: organization.data.name,
        email: organization.data.email ?? '',
        phone: organization.data.phone ?? '',
        address: organization.data.address ?? '',
        taxNumber: organization.data.taxNumber ?? '',
        currency: organization.data.currency,
      });
    }
  }, [organization.data]);

  useEffect(() => {
    if (settings.data) setConfig(settings.data);
  }, [settings.data]);

  const saveOrg = useMutation({
    mutationFn: async () =>
      put('/api/admin/organization', {
        name: org.name,
        email: org.email || null,
        phone: org.phone || null,
        address: org.address || null,
        taxNumber: org.taxNumber || null,
        currency: org.currency,
      }),
    onSuccess: () => {
      setSaved('Organization profile saved.');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['/api/admin/organization'] });
    },
    onError: setError,
  });

  const saveSettings = useMutation({
    mutationFn: async () =>
      put('/api/admin/settings', {
        allowNegativeStock: config?.allowNegativeStock,
        valuationMethod: config?.valuationMethod,
        useFefoForPerishables: config?.useFefoForPerishables,
        allowExpiredConsumption: config?.allowExpiredConsumption,
        reservationTtlMinutes: Number(config?.reservationTtlMinutes ?? 60),
        adjustmentApprovalValue: Number(config?.adjustmentApprovalValue ?? 0),
        notifyByEmail: config?.notifyByEmail,
        notifyInApp: config?.notifyInApp,
      }),
    onSuccess: () => {
      setSaved('Inventory policy saved.');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['/api/admin/settings'] });
    },
    onError: setError,
  });

  if (!canManage) {
    return (
      <>
        <PageHeader title="Organization settings" />
        <Card>
          <EmptyState message="You do not have permission to manage settings." />
        </Card>
      </>
    );
  }

  if (organization.isPending || settings.isPending) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Organization settings"
        subtitle="Inventory policy is enforced server-side for every stock operation"
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}
      {saved ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {saved}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-base font-semibold text-slate-900">Organization profile</h2>
          <p className="mt-1 text-xs text-slate-400">
            {organization.data?._count.users} users · {organization.data?._count.warehouses} warehouses ·{' '}
            {organization.data?._count.products} products
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className="input"
                value={org.name}
                onChange={(event) => setOrg({ ...org, name: event.target.value })}
              />
            </Field>
            <Field label="Currency" hint="3-letter ISO code">
              <input
                className="input"
                maxLength={3}
                value={org.currency}
                onChange={(event) => setOrg({ ...org, currency: event.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={org.email}
                onChange={(event) => setOrg({ ...org, email: event.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className="input"
                value={org.phone}
                onChange={(event) => setOrg({ ...org, phone: event.target.value })}
              />
            </Field>
            <Field label="Tax number">
              <input
                className="input"
                value={org.taxNumber}
                onChange={(event) => setOrg({ ...org, taxNumber: event.target.value })}
              />
            </Field>
            <Field label="Address">
              <input
                className="input"
                value={org.address}
                onChange={(event) => setOrg({ ...org, address: event.target.value })}
              />
            </Field>
          </div>
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={saveOrg.isPending}
            onClick={() => saveOrg.mutate()}
          >
            {saveOrg.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-slate-900">Inventory policy</h2>
          <div className="mt-3 space-y-3">
            <Field label="Valuation method">
              <select
                className="input"
                value={config?.valuationMethod ?? 'WEIGHTED_AVERAGE'}
                onChange={(event) =>
                  setConfig((current) =>
                    current
                      ? {
                          ...current,
                          valuationMethod: event.target.value as Settings['valuationMethod'],
                        }
                      : current,
                  )
                }
              >
                <option value="WEIGHTED_AVERAGE">Weighted average</option>
                <option value="FIFO">FIFO</option>
              </select>
            </Field>
            <Field label="Reservation TTL (minutes)">
              <input
                className="input"
                type="number"
                min={5}
                max={10080}
                value={config?.reservationTtlMinutes ?? 60}
                onChange={(event) =>
                  setConfig((current) =>
                    current
                      ? { ...current, reservationTtlMinutes: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </Field>
            <Field
              label="Adjustment approval threshold"
              hint="Adjustments above this value require a second approval"
            >
              <input
                className="input"
                type="number"
                step="any"
                min={0}
                value={config?.adjustmentApprovalValue ?? '0'}
                onChange={(event) =>
                  setConfig((current) =>
                    current ? { ...current, adjustmentApprovalValue: event.target.value } : current,
                  )
                }
              />
            </Field>

            {(
              [
                ['allowNegativeStock', 'Allow negative stock'],
                ['useFefoForPerishables', 'Use FEFO for perishables'],
                ['allowExpiredConsumption', 'Allow consuming expired stock'],
                ['notifyInApp', 'In-app notifications'],
                ['notifyByEmail', 'Email notifications'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={Boolean(config?.[key])}
                  onChange={(event) =>
                    setConfig((current) =>
                      current ? { ...current, [key]: event.target.checked } : current,
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate()}
          >
            {saveSettings.isPending ? 'Saving…' : 'Save policy'}
          </button>
        </Card>
      </div>
    </>
  );
}
