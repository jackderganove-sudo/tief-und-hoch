/** Lädt alle Pixel-Grafiken aus src/assets/pixel (Schlüssel z. B. "sunny/tileset"). */
const urls = import.meta.glob('../assets/pixel/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type Images = Record<string, HTMLImageElement>;

let cache: Promise<Images> | null = null;

export function loadImages(): Promise<Images> {
  cache ??= Promise.all(
    Object.entries(urls).map(
      ([path, url]) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([path.replace('../assets/pixel/', '').replace('.png', ''), img]);
          img.onerror = () => reject(new Error(`Bild fehlt: ${path}`));
          img.src = url;
        }),
    ),
  ).then((list) => Object.fromEntries(list));
  return cache;
}

/** URL einer einzelnen Grafik (für CSS, z. B. 9-Slice-Rahmen). */
export function assetUrl(key: string): string {
  return urls[`../assets/pixel/${key}.png`];
}
