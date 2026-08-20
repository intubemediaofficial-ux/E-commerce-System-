'use client';

import { CrudPage, StatusCell } from '@/components/CrudPage';
import { useAuth } from '@/components/AuthProvider';
import { useLocationOptions } from '@/hooks/useOptions';
import { titleCase } from '@/lib/format';
import type { Warehouse } from '@/lib/types';

interface WarehouseRow extends Warehouse {
  location?: { id: string; name: string } | null;
  manager?: { id: string; name: string } | null;
}

const WAREHOUSE_TYPES = [
  'MAIN_WAREHOUSE',
  'BRANCH_WAREHOUSE',
  'RESTAURANT_KITCHEN',
  'COLD_STORAGE',
  'PACKAGING_STORE',
  'RETAIL_STORE',
];

export default function WarehousesPage() {
  const { can } = useAuth();
  const { options: locations } = useLocationOptions();

  return (
    <CrudPage<WarehouseRow>
      title="Warehouses"
      subtitle="Stores, kitchens and cold rooms holding stock"
      path="/api/warehouses"
      canManage={can('warehouse.manage')}
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Code', cell: (row) => row.code },
        { header: 'Type', cell: (row) => titleCase(row.type) },
        { header: 'Location', cell: (row) => row.location?.name ?? '—' },
        { header: 'Manager', cell: (row) => row.manager?.name ?? '—' },
        { header: 'Status', cell: (row) => <StatusCell value={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
        {
          name: 'type',
          label: 'Type',
          type: 'select',
          options: WAREHOUSE_TYPES.map((type) => ({ value: type, label: titleCase(type) })),
        },
        { name: 'locationId', label: 'Location', type: 'select', options: locations },
        { name: 'address', label: 'Address', type: 'textarea' },
      ]}
    />
  );
}
