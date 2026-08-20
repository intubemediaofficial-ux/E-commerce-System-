'use client';

import { CrudPage, StatusCell } from '@/components/CrudPage';
import { useAuth } from '@/components/AuthProvider';
import { money } from '@/lib/format';
import type { Supplier } from '@/lib/types';

export default function SuppliersPage() {
  const { can } = useAuth();
  return (
    <CrudPage<Supplier>
      title="Suppliers"
      subtitle="Vendors, payment terms and credit exposure"
      path="/api/suppliers"
      canManage={can('supplier.manage')}
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Company', cell: (row) => row.companyName ?? '—' },
        { header: 'Email', cell: (row) => row.email ?? '—' },
        { header: 'Phone', cell: (row) => row.phone ?? '—' },
        { header: 'Terms', cell: (row) => row.paymentTerms ?? '—' },
        { header: 'Credit limit', align: 'right', cell: (row) => money(row.creditLimit) },
        { header: 'Status', cell: (row) => <StatusCell value={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Contact name', required: true },
        { name: 'companyName', label: 'Company name' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone' },
        { name: 'taxNumber', label: 'Tax number' },
        { name: 'paymentTerms', label: 'Payment terms' },
        { name: 'creditLimit', label: 'Credit limit', type: 'number' },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  );
}
