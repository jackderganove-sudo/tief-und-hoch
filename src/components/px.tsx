import { useMemo, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import type { TierId } from '../domain/types';
import { tierIconSprite, type Sprite } from '../pixel/sprites';

const urlCache = new Map<string, string>();

function spriteUrl(key: string, make: () => Sprite) {
  let u = urlCache.get(key);
  if (!u) urlCache.set(key, (u = make().toDataURL()));
  return u;
}

/** Pixel-Sprite als Bild, ganzzahlig skaliert. */
export function PixelSprite({ id, make, w, h, scale = 3, className = '' }: { id: string; make: () => Sprite; w: number; h: number; scale?: number; className?: string }) {
  const src = useMemo(() => spriteUrl(id, make), [id, make]);
  return <img src={src} width={w * scale} height={h * scale} alt="" aria-hidden className={`pixelated inline-block ${className}`} />;
}

export function TierIcon({ tier, scale = 3, className = '' }: { tier: TierId; scale?: number; className?: string }) {
  return <PixelSprite id={`tier-${tier}`} make={() => tierIconSprite(tier)} w={16} h={16} scale={scale} className={className} />;
}

export type PanelTone = 'wood' | 'stone';

/** 9-Slice-Rahmen. */
export function Panel({ tone, className = '', children, ...rest }: { tone: PanelTone; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`${tone === 'wood' ? 'px-wood' : 'px-stone'} ${className}`}>
      {children}
    </div>
  );
}

export type ButtonTone = 'gold' | 'teal' | 'coral' | 'wood' | 'stone';

export function PxButton({ tone, small = false, className = '', children, ...rest }: { tone: ButtonTone; small?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`px-btn px-btn-${tone} ${small ? 'px-btn-sm' : ''} ${className}`}>
      <span className="px-btn-label">{children}</span>
    </button>
  );
}
