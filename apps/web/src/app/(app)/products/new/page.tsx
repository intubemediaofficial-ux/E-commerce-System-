'use client';

import { ProductForm } from '@/components/ProductForm';
import { PageHeader } from '@/components/ui';

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="Add Product" subtitle="Six fields, nothing else" />
      <ProductForm />
    </>
  );
}
