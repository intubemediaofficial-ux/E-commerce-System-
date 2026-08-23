'use client';

import { useRef, useState } from 'react';
import clsx from 'clsx';
import { assetUrl, uploadImage } from '@/lib/api';

/**
 * Product photo control: drag-and-drop, file picker and (on phones/tablets)
 * direct camera capture. The parent stores the returned path on the record.
 */
export function ImageUploader({
  value,
  onChange,
  label = 'Product photo',
  hint = 'JPEG, PNG, WebP or GIF · up to 5 MB',
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (file: File | undefined | null): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(file);
      onChange(uploaded.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const preview = assetUrl(value);

  return (
    <div>
      <span className="label">{label}</span>
      <div
        className={clsx(
          'flex items-center gap-4 rounded-xl border border-dashed p-3 transition',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void send(event.dataTransfer.files?.[0]);
        }}
      >
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Product" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-medium text-slate-400">No photo</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary px-2.5 py-1.5 text-xs"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? 'Uploading…' : preview ? 'Replace photo' : 'Upload photo'}
            </button>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1.5 text-xs"
              disabled={busy}
              onClick={() => cameraInput.current?.click()}
            >
              Use camera
            </button>
            {preview ? (
              <button
                type="button"
                className="btn-ghost px-2.5 py-1.5 text-xs"
                disabled={busy}
                onClick={() => {
                  onChange(null);
                  setError(null);
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-400">{hint} · drag and drop works too</p>
          {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void send(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          void send(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
