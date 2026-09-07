'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { get } from '@/lib/api';
import { ProductForm } from '@/components/ProductForm';
import { ErrorState, PageHeader, Spinner } from '@/components/ui';
import type { Product } from '@/lib/types';

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isPending, error } = useQuery({
    queryKey: [`/api/products/${id}`],
    queryFn: async () => (await get<Product>(`/api/products/${id}`)).data,
  });

  if (isPending) return <Spinner label="Loading product" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader title="Edit Product" subtitle={data.name} />
      <ProductForm product={data} />
    </>
  );
}
