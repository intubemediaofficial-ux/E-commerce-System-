'use client';

import { CrudPage, StatusCell } from '@/components/CrudPage';
import { useAuth } from '@/components/AuthProvider';
import type { Location } from '@/lib/types';

interface LocationRow extends Location {
  _count?: { warehouses: number };
}

export default function LocationsPage() {
  const { can } = useAuth();
  return (
    <CrudPage<LocationRow>
      title="Locations"
      subtitle="Branches and sites that group warehouses and kitchens"
      path="/api/locations"
      canManage={can('location.manage')}
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Code', cell: (row) => row.code },
        { header: 'City', cell: (row) => row.city ?? '—' },
        { header: 'Warehouses', align: 'right', cell: (row) => String(row._count?.warehouses ?? 0) },
        { header: 'Status', cell: (row) => <StatusCell value={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Code', required: true },
        { name: 'city', label: 'City' },
        { name: 'state', label: 'State' },
        { name: 'country', label: 'Country' },
        { name: 'address', label: 'Address', type: 'textarea' },
      ]}
    />
  );
}
