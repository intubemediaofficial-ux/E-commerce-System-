'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function detectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return candidate ?? null;
}

/** True when the browser can decode barcodes from a camera stream natively. */
export function cameraScanningSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    detectorConstructor() !== null &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Live camera barcode scanner built on the native BarcodeDetector API (Chrome
 * and Android browsers). Hardware scanners do not need this — they type into
 * the keyboard-wedge input instead.
 */
export function BarcodeCamera({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastCode = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const stop = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  useEffect(() => setSupported(cameraScanningSupported()), []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!active) return;
    const Detector = detectorConstructor();
    if (!Detector) return;

    let cancelled = false;
    const detector = new Detector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'],
    });

    const start = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError('Camera access was denied or is unavailable.');
        setActive(false);
        return;
      }

      const tick = async (): Promise<void> => {
        if (cancelled || !videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const results = await detector.detect(videoRef.current);
          const code = results[0]?.rawValue?.trim();
          const now = Date.now();
          if (code && (code !== lastCode.current.code || now - lastCode.current.at > 2500)) {
            lastCode.current = { code, at: now };
            onDetected(code);
          }
        } catch {
          // Frames can fail to decode; keep polling.
        }
      };

      const interval = window.setInterval(() => void tick(), 400);
      cleanup = () => window.clearInterval(interval);
    };

    let cleanup: (() => void) | undefined;
    void start();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [active, onDetected]);

  if (!supported) {
    return (
      <p className="text-xs text-slate-500">
        This browser cannot scan with the camera. Use a USB/Bluetooth scanner, or open the page in
        Chrome on Android.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={active ? 'btn-secondary' : 'btn-primary'}
          onClick={() => (active ? stop() : setActive(true))}
        >
          {active ? 'Stop camera' : 'Scan with camera'}
        </button>
        {active ? <span className="chip">Point the camera at the barcode</span> : null}
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
      <video
        ref={videoRef}
        muted
        playsInline
        className={
          active
            ? 'mt-3 w-full max-w-sm rounded-xl border border-slate-200 bg-slate-900'
            : 'hidden'
        }
      />
    </div>
  );
}
