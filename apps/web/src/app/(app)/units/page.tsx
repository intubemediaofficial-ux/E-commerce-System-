'use client';

import { CrudPage, StatusCell } from '@/components/CrudPage';
import { useAuth } from '@/components/AuthProvider';
import type { Unit } from '@/lib/types';

interface UnitRow extends Unit {
  status?: string;
  factorToBase?: string;
  isBase?: boolean;
}

export default function UnitsPage() {
  const { can } = useAuth();
  return (
    <CrudPage<UnitRow>
      title="Units"
      subtitle="Base units and conversion factors used to normalise stock"
      path="/api/units"
      canManage={can('unit.manage')}
      columns={[
        { header: 'Code', cell: (row) => row.code },
        { header: 'Name', cell: (row) => row.name },
        { header: 'Dimension', cell: (row) => row.dimension },
        { header: 'Factor to base', align: 'right', cell: (row) => row.factorToBase ?? '1' },
        { header: 'Base unit', cell: (row) => (row.isBase ? 'Yes' : 'No') },
        { header: 'Status', cell: (row) => <StatusCell value={row.status} /> },
      ]}
      fields={[
        { name: 'code', label: 'Code', required: true },
        { name: 'name', label: 'Name', required: true },
        {
          name: 'dimension',
          label: 'Dimension',
          type: 'select',
          options: [
            { value: 'COUNT', label: 'Count' },
            { value: 'WEIGHT', label: 'Weight' },
            { value: 'VOLUME', label: 'Volume' },
            { value: 'LENGTH', label: 'Length' },
          ],
        },
        {
          name: 'factorToBase',
          label: 'Factor to base unit',
          type: 'number',
          hint: 'e.g. 0.001 for gram when kilogram is the base unit',
        },
        { name: 'isBase', label: 'Is base unit', type: 'checkbox' },
      ]}
    />
  );
}
