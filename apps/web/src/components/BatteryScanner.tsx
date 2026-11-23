'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, ImageUp } from 'lucide-react';
type Decoder = typeof import('jsqr').default;

function readCode(jsQR: Decoder, image: CanvasImageSource, width: number, height: number) {
  if (!width || !height) return null;
  const scale = Math.min(1, 1280 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法读取图像');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const raw = jsQR(pixels.data, pixels.width, pixels.height)?.data.trim();
  if (!raw) return null;
  if (/^[A-Z0-9]{24}$/.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('不是有效的电池档案码');
  }
  const code = url.searchParams.get('code') ?? '';
  if (url.origin !== window.location.origin || url.pathname !== '/identity' || !/^[A-Z0-9]{24}$/.test(code)) {
    throw new Error('不是本站的电池档案码');
  }
  return code;
}

export function BatteryScanner({ onRead }: { onRead: (code: string, record: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [record, setRecord] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return;
    let closed = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('相机需要 HTTPS 或 localhost，可选择二维码图片');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (closed || !video.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        const player = video.current;
        player.srcObject = stream;
        await player.play();
        const { default: decode } = await import('jsqr');
        const frame = () => {
          if (closed) return;
          try {
            const code = readCode(decode, player, player.videoWidth, player.videoHeight);
            if (code) {
              setActive(false);
              onRead(code, record);
              return;
            }
            timer = setTimeout(frame, 200);
          } catch {
            setActive(false);
            setMessage('无法识别本站电池档案码');
          }
        };
        frame();
      } catch {
        if (!closed) {
          setActive(false);
          setMessage('相机不可用或未获授权，可选择二维码图片');
        }
      }
    }
    void start();
    return () => {
      closed = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [active, onRead, record]);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas/80 px-3.5 py-2.5 text-xs">
      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink-secondary select-none">
        <input
          type="checkbox"
          checked={record}
          disabled={active}
          onChange={e => setRecord(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-line accent-brand"
        />
        扫码时登记本站
      </label>

      <button
        type="button"
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition ${
          active
            ? 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/15'
            : 'border-line bg-white text-ink hover:border-brand/40 hover:bg-subtle/60'
        }`}
        onClick={() => {
          setMessage('');
          setActive(!active);
        }}
      >
        <Camera className="h-3.5 w-3.5 text-brand" />
        {active ? '关闭相机' : '相机扫码查档'}
      </button>

      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-ink transition hover:border-brand/40 hover:bg-subtle/60">
        <ImageUp className="h-3.5 w-3.5 text-teal" />
        <span>识别二维码图片</span>
        <input
          type="file"
          accept="image/*"
          className="max-w-44 text-[11px] text-ink-secondary file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-subtle file:px-2 file:py-0.5 file:text-[11px] file:font-semibold file:text-ink"
          onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setActive(false);
            setMessage('');
            let img: ImageBitmap | undefined;
            try {
              if (file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MiB 以内的图片');
              img = await createImageBitmap(file);
              const { default: decode } = await import('jsqr');
              const code = readCode(decode, img, img.width, img.height);
              if (!code) throw new Error('未识别到二维码');
              onRead(code, record);
            } catch (err) {
              setMessage(err instanceof Error ? err.message : '图片读取失败');
            } finally {
              img?.close();
            }
          }}
        />
      </label>

      {active && <video ref={video} muted playsInline className="w-64 rounded-lg border border-line shadow-sm" aria-label="扫码相机画面" />}
      {message && (
        <span role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-medium text-danger">
          {message}
        </span>
      )}
    </div>
  );
}
