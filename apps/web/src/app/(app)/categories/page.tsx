'use client';

import { CrudPage, StatusCell } from '@/components/CrudPage';
import { useAuth } from '@/components/AuthProvider';
import { useCategoryOptions } from '@/hooks/useOptions';
import type { Category } from '@/lib/types';

export default function CategoriesPage() {
  const { can } = useAuth();
  const { options } = useCategoryOptions();

  return (
    <CrudPage<Category>
      title="Categories"
      subtitle="Hierarchical grouping for products and ingredients"
      path="/api/categories"
      canManage={can('category.manage')}
      columns={[
        { header: 'Name', cell: (row) => row.name },
        {
          header: 'Parent',
          cell: (row) => options.find((option) => option.value === row.parentCategoryId)?.label ?? '—',
        },
        { header: 'Status', cell: (row) => <StatusCell value={row.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'parentCategoryId', label: 'Parent category', type: 'select', options },
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
