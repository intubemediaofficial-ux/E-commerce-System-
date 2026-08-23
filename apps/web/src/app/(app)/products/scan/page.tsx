'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { assetUrl, get, put } from '@/lib/api';
import { money, qty, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { BarcodeCamera } from '@/components/BarcodeCamera';
import { ImageUploader } from '@/components/ImageUploader';
import { Badge, Card, DataTable, ErrorState, Field, PageHeader } from '@/components/ui';
import type { Product } from '@/lib/types';

interface LookupResult {
  product: Product;
  variant: { id: string; name: string; sku: string } | null;
}

interface HistoryEntry {
  code: string;
  at: string;
  label: string;
  found: boolean;
}

/** Short confirmation tone so operators know the scan registered hands-free. */
function beep(ok: boolean): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (ok ? 0.09 : 0.25));
    oscillator.onended = () => void context.close();
  } catch {
    // Audio is a nicety; ignore autoplay restrictions.
  }
}

export default function ScanLookupPage() {
  const { can } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedPhoto, setSavedPhoto] = useState<string | null>(null);

  const lookup = useCallback(async (raw: string): Promise<void> => {
    const value = raw.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setSavedPhoto(null);
    try {
      const response = await get<LookupResult>('/api/products/lookup', { code: value });
      setResult(response.data);
      beep(true);
      setHistory((rows) =>
        [
          {
            code: value,
            at: new Date().toLocaleTimeString(),
            label: response.data.variant
              ? `${response.data.product.name} · ${response.data.variant.name}`
              : response.data.product.name,
            found: true,
          },
          ...rows,
        ].slice(0, 25),
      );
    } catch (caught) {
      setResult(null);
      setError(caught);
      beep(false);
      setHistory((rows) =>
        [{ code: value, at: new Date().toLocaleTimeString(), label: 'Not found', found: false }, ...rows].slice(
          0,
          25,
        ),
      );
    } finally {
      setBusy(false);
      setCode('');
      inputRef.current?.focus();
    }
  }, []);

  // Keep the wedge input focused so a hardware scanner always reaches it.
  useEffect(() => {
    inputRef.current?.focus();
    const refocus = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, video, label')) return;
      inputRef.current?.focus();
    };
    window.addEventListener('click', refocus);
    return () => window.removeEventListener('click', refocus);
  }, []);

  const savePhoto = async (url: string | null): Promise<void> => {
    if (!result) return;
    setError(null);
    try {
      await put(`/api/products/${result.product.id}`, { imageUrl: url });
      setResult({ ...result, product: { ...result.product, imageUrl: url } });
      setSavedPhoto(url ? 'Photo saved to the product.' : 'Photo removed from the product.');
    } catch (caught) {
      setError(caught);
    }
  };

  const stock = result?.product.stock ?? [];
  const photo = assetUrl(result?.product.imageUrl);

  return (
    <>
      <PageHeader
        title="Scan station"
        subtitle="USB, Bluetooth and camera scanners resolve a barcode or SKU instantly"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void lookup(code);
            }}
          >
            <Field
              label="Barcode or SKU"
              hint="Hardware scanners type the code and press Enter automatically"
            >
              <input
                ref={inputRef}
                className="input text-lg font-semibold tracking-wide"
                autoFocus
                autoComplete="off"
                value={code}
                placeholder="Scan or type a code…"
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? 'Looking up…' : 'Look up'}
              </button>
              {result ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                    inputRef.current?.focus();
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </form>

          <div className="mt-4 border-t border-slate-200 pt-4">
            <BarcodeCamera onDetected={(scanned) => void lookup(scanned)} />
          </div>
        </Card>

        <Card>
          <p className="label">Recent scans</p>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">Scans from this session appear here.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((entry, index) => (
                <li
                  key={`${entry.code}-${index}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-700">{entry.label}</span>
                    <span className="font-mono text-xs text-slate-400">{entry.code}</span>
                  </span>
                  <span
                    className={
                      entry.found
                        ? 'text-xs font-semibold text-emerald-600'
                        : 'text-xs font-semibold text-rose-600'
                    }
                  >
                    {entry.at}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={result.product.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-slate-400">No photo</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-900">
                  {result.product.name}
                </p>
                <p className="font-mono text-xs text-slate-500">{result.product.sku}</p>
                {result.variant ? (
                  <p className="mt-1 text-sm text-slate-600">Variant: {result.variant.name}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge value={result.product.status} />
                  <span className="chip">{titleCase(result.product.productType)}</span>
                  <span className="chip">{result.product.unit?.code ?? '—'}</span>
                </div>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="surface-muted">
                <dt className="text-xs text-slate-500">Purchase price</dt>
                <dd className="font-semibold text-slate-800">{money(result.product.purchasePrice)}</dd>
              </div>
              <div className="surface-muted">
                <dt className="text-xs text-slate-500">Selling price</dt>
                <dd className="font-semibold text-slate-800">{money(result.product.sellingPrice)}</dd>
              </div>
            </dl>

            {can('product.update') ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <ImageUploader
                  label="Attach photo to this product"
                  value={result.product.imageUrl ?? null}
                  onChange={(url) => void savePhoto(url)}
                />
                {savedPhoto ? (
                  <p className="mt-2 text-xs font-medium text-emerald-600">{savedPhoto}</p>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card className="lg:col-span-2">
            <p className="label">Stock by warehouse</p>
            <DataTable
              rows={stock}
              emptyMessage="This product has no stock rows yet."
              rowKey={(row) => row.warehouseId}
              columns={[
                { header: 'Warehouse', cell: (row) => row.warehouse?.name ?? row.warehouseId },
                { header: 'On hand', align: 'right', cell: (row) => qty(row.quantity) },
                { header: 'Reserved', align: 'right', cell: (row) => qty(row.reservedQuantity) },
                {
                  header: 'Available',
                  align: 'right',
                  cell: (row) => qty(Number(row.quantity) - Number(row.reservedQuantity)),
                },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
