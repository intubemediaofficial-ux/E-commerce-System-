'use client';

import { assetUrl } from '@/lib/api';
import type { Product } from '@/lib/types';

export function ProductThumb({ product }: { product: Pick<Product, 'name' | 'imageUrl'> }) {
  const src = assetUrl(product.imageUrl);
  if (!src) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase text-slate-400">
        {product.name.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={product.name}
      className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
    />
  );
}
