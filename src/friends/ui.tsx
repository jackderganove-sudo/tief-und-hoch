import { useEffect, useRef } from 'react';
import qrcode from 'qrcode-generator';
import { avatarSprite } from '../pixel/avatars';
import { playerColor } from '../pixel/playerColors';
import { PixelSprite } from '../components/px';
import type { RoomPlayer } from './roomApi';

/** Avatar mit Rahmen in Spielerfarbe; optional Krone (Gastgeber) und Häkchen (hat geantwortet). */
export function Avatar({
  player,
  scale = 3,
  crown = false,
  check = false,
  dim = false,
}: {
  player: Pick<RoomPlayer, 'avatar' | 'color'>;
  scale?: number;
  crown?: boolean;
  check?: boolean;
  dim?: boolean;
}) {
  return (
    <span className={`relative inline-block shrink-0 ${dim ? 'opacity-45' : ''}`}>
      <span className="block p-[2px]" style={{ background: playerColor(player.color) }}>
        <PixelSprite id={`av-${player.avatar}`} make={() => avatarSprite(player.avatar)} w={12} h={12} scale={scale} className="block bg-[#1d1626]" />
      </span>
      {crown && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm leading-none" aria-label="Gastgeber">
          👑
        </span>
      )}
      {check && <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center bg-[#7ec850] text-[0.6rem] font-bold text-[#17301a]">✓</span>}
    </span>
  );
}

/** QR-Code als Pixel-Grafik (passt zum Stil, gestochen scharf). */
export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    const cv = ref.current!;
    cv.width = n + quiet * 2;
    cv.height = n + quiet * 2;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff6e0';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#2b1a10';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect(x + quiet, y + quiet, 1, 1);
  }, [text]);
  return <canvas ref={ref} className="pixelated block" style={{ width: size, height: size }} aria-label="QR-Code" role="img" />;
}

/** Kurze Vibration (Android; iOS ignoriert das). */
export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* egal */
  }
}

/** Namen hübsch aufzählen: „Max“, „Max und Lisa“, „Max, Lisa und Tom“, „5 andere“. */
export function listNames(names: string[], and: string, others: (n: number) => string, max = 3): string {
  if (names.length === 0) return '';
  if (names.length > max) return others(names.length);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
}
