'use client';

import { CrudPage, StatusCell } from '@/components/CrudPage';
import { useAuth } from '@/components/AuthProvider';
import type { Brand } from '@/lib/types';

export default function BrandsPage() {
  const { can } = useAuth();
  return (
    <CrudPage<Brand>
      title="Brands"
      subtitle="Manufacturer and label metadata for the catalogue"
      path="/api/brands"
      canManage={can('brand.manage')}
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Status', cell: (row) => <StatusCell value={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ],
        },
      ]}
    />
  );
}
