#!/usr/bin/env python3
"""
App-Icons für Highs & Lows – Pixel-Art, selbst gezeichnet.

Das Motiv liegt in der inneren 24×24-Zone eines 32er-Rasters (75 %), damit es
auch als „maskable“ Icon (Sicherheitszone 80 %) vollständig sichtbar bleibt.
Hintergrund (Himmel/Höhle) läuft bis zum Rand. Jede Zielgröße wird auf einem
eigenen Raster gezeichnet und NUR ganzzahlig per Nearest-Neighbor vergrößert:
  192 = 32×6, 512 = 32×16, 180 (Apple) = 36×5, Favicon 32 = 32×1, 64 = 32×2.

  python3 scripts/make-icons.py                 → public/icons/* (Variante aus VARIANT)
  python3 scripts/make-icons.py --preview       → zusätzlich screenshots/icon-preview.png (alle Varianten)
  python3 scripts/make-icons.py --variant=b     → andere Variante schreiben
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VARIANT = 'a'  # gewählt: siehe README / Begründung im Commit

# Palette aus den ansimuz-Packs (Sunny Land, Caverns, Warped Caves) + Spiel-Ballon
P = {
    'sky0': '#2fbdff', 'sky1': '#47f3ff', 'sky2': '#8cf7ff', 'cloud': '#ffffff', 'cloudS': '#b3effc',
    'grass': '#7ec850', 'grassD': '#4e9a3a', 'dirt': '#8a4b2e', 'dirtD': '#5c2e22',
    'cave0': '#382a3b', 'cave1': '#2c212e', 'cave2': '#190e1b', 'rock': '#564259', 'rockL': '#6b536f',
    'glow0': '#533794', 'glow1': '#3d83b3',
    'cr0': '#ffffff', 'cr1': '#68eef2', 'cr2': '#51b9db', 'cr3': '#6d5ad9', 'crO': '#190e1b',
    'red': '#e2603a', 'orange': '#f2b53a', 'cream': '#fff3d6', 'redD': '#a8372a', 'line': '#3a2416',
    'basket': '#a0602e', 'basketD': '#6a3a1e', 'lamp': '#fff3a0', 'beam': '#c8b05a',
    'skin': '#f2c48d', 'helmet': '#f2d03a', 'shirt': '#3d83b3', 'pants': '#5c2e22',
}


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


class Grid:
    def __init__(self, n):
        self.n = n
        self.o = (n - 32) // 2  # Motiv-Ursprung: 32er-Raster mittig
        self.px = [[None] * n for _ in range(n)]

    def set(self, x, y, c, motif=True):
        if motif:
            x += self.o
            y += self.o
        if 0 <= x < self.n and 0 <= y < self.n and c:
            self.px[y][x] = P[c] if c in P else c

    def get(self, x, y):
        x += self.o
        y += self.o
        return self.px[y][x] if 0 <= x < self.n and 0 <= y < self.n else None

    def sprite(self, x0, y0, rows, key):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch != '.':
                    self.set(x0 + dx, y0 + dy, key[ch])

    def image(self, scale):
        im = Image.new('RGBA', (self.n, self.n))
        im.putdata([hexrgb(c) if c else (0, 0, 0, 0) for row in self.px for c in row])
        return im.resize((self.n * scale, self.n * scale), Image.NEAREST)


# ---------------------------------------------------------------- Bausteine

def balloon(g, x0, y0):
    """Ballon wie im Spiel: Bahnen rot/creme/orange, rechte Seite schattiert, 12×13."""
    half = [2.5, 4.5, 5.5, 5.5, 5.5, 4.5, 3.5, 2.5, 1.5]
    cols = ['r', 'r', 'c', 'o', 'o', 'c', 'c', 'o', 'o', 'c', 'r', 'r']
    color = {'r': 'red', 'c': 'cream', 'o': 'orange'}
    dark = {'r': 'redD', 'c': '#d8bf8c', 'o': '#cf7d27'}
    light = {'r': '#f47b5c', 'c': '#fff4d6', 'o': '#ffc163'}
    inside = lambda x, y: 0 <= y < len(half) and abs(x - 5.5) <= half[y]  # noqa: E731
    for y in range(len(half)):
        for x in range(12):
            if not inside(x, y):
                continue
            edge = not (inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1))
            c = cols[x]
            col = '#3a2030' if edge else dark[c] if x >= 9 else light[c] if x <= 2 and y < 5 else color[c]
            g.set(x0 + x, y0 + y, col)
    # Brennerrahmen, Seile, Korb
    for x in range(4, 8):
        g.set(x0 + x, y0 + 9, '#3a2030')
    g.set(x0 + 4, y0 + 10, '#5b4636')
    g.set(x0 + 7, y0 + 10, '#5b4636')
    g.sprite(x0 + 4, y0 + 11, ['kbbk', 'kkkk'], {'k': 'line', 'b': 'basket'})


CRYSTAL = [
    '.....k......',
    '....kwk.....',
    '....kwck..k.',
    '.k..kwcCkkwk',
    'kwk.kwcCkwcCk'[:12],
    'kwckkwcCkwCk',
    'kwcCkwcCkwCk',
    'kwcCkwcCkcCk',
    '.kkkkkkkkkk.',
]
# heller Körper, violette statt schwarze Kontur – bleibt auch bei 48 px sichtbar
CRYSTAL_KEY = {'k': '#3b1158', 'w': 'cr0', 'c': 'cr1', 'C': 'cr2'}

CLOUD = ['..ww...', '.wwwww.', 'wwwwwws', '.sssss.']
CLOUD_KEY = {'w': 'cloud', 's': 'cloudS'}

EXPLORER = [
    '..hhh..',
    '.hhhhhL',
    '..sss..',
    '..sss..',
    '.ttttt.',
    '.ttttt.',
    '..p.p..',
    '..p.p..',
]
EXPLORER_KEY = {'h': 'helmet', 'L': 'lamp', 's': 'skin', 't': 'shirt', 'p': 'pants'}


def sky(g, y0, y1, x_of=None):
    """Himmel in drei Bändern (oben dunkler), über das ganze Raster."""
    for y in range(-g.o, 32 + g.o):
        for x in range(-g.o, 32 + g.o):
            if x_of and not x_of(x, y):
                continue
            if y0 <= y < y1 or x_of:
                t = (y + g.o) / g.n
                g.set(x, y, 'sky0' if t < 0.22 else 'sky1' if t < 0.44 else 'sky2')


def cave(g, y0, x_of=None):
    for y in range(-g.o, 32 + g.o):
        for x in range(-g.o, 32 + g.o):
            if x_of and not x_of(x, y):
                continue
            if y >= y0 or x_of:
                t = (y + g.o) / g.n
                c = 'cave0' if t < 0.7 else 'cave1' if t < 0.86 else 'cave2'
                # gelegentliche Felspunkte für Struktur
                if (x * 7 + y * 13) % 23 == 0:
                    c = 'rock'
                g.set(x, y, c)


def glow(g, cx, cy, r):
    """Kristall-Leuchten: zwei Ringe, gedithert (kein weicher Verlauf)."""
    for y in range(cy - r - 1, cy + r + 2):
        for x in range(cx - r - 1, cx + r + 2):
            d = ((x - cx) ** 2 + ((y - cy) * 1.1) ** 2) ** 0.5
            if g.get(x, y) in (P['cave0'], P['cave1'], P['cave2'], P['rock']):
                if d < r * 0.55:
                    g.set(x, y, 'glow1' if (x + y) % 2 else 'cr3')
                elif d < r * 0.8:
                    g.set(x, y, 'cr3' if (x + y) % 2 else 'glow0')
                elif d < r and (x + y) % 2 == 0:
                    g.set(x, y, 'glow0')


def horizon(g, y):
    for x in range(-g.o, 32 + g.o):
        g.set(x, y, 'grass')
        g.set(x, y + 1, 'grassD' if x % 3 else 'grass')
        g.set(x, y + 2, 'dirt')
        g.set(x, y + 3, 'dirtD' if x % 2 else 'dirt')


# ---------------------------------------------------------------- Varianten

def variant_a(n):
    """Waagerecht geteilt: Ballon im Himmel, leuchtender Kristall in der Höhle."""
    g = Grid(n)
    sky(g, -99, 18)
    cave(g, 18)
    horizon(g, 17)
    g.sprite(22, 6, CLOUD, CLOUD_KEY)
    balloon(g, 10, 4)
    glow(g, 16, 24, 9)
    g.sprite(10, 19, CRYSTAL, CRYSTAL_KEY)
    return g


def variant_b(n):
    """Diagonal geteilt: Himmel oben links, Höhle unten rechts."""
    g = Grid(n)
    diag = lambda x, y: x + y < 31  # noqa: E731
    sky(g, 0, 0, diag)
    cave(g, 0, lambda x, y: not diag(x, y))
    for x in range(-g.o, 32 + g.o):  # treppige Graskante entlang der Diagonale
        y = 30 - x
        g.set(x, y, 'grass')
        g.set(x, y + 1, 'grassD')
        g.set(x + 1, y + 1, 'dirt')
    balloon(g, 4, 4)
    glow(g, 22, 23, 8)
    g.sprite(16, 18, CRYSTAL, CRYSTAL_KEY)
    return g


def variant_c(n):
    """Waagerecht geteilt: Ballon oben, Forscher mit Stirnlampe am Seil unten."""
    g = Grid(n)
    sky(g, -99, 18)
    cave(g, 18)
    horizon(g, 17)
    balloon(g, 10, 4)
    for y in range(21, 21):
        g.set(15, y, 'beam')
    # Lichtkegel der Stirnlampe nach rechts unten
    for i in range(1, 9):
        for j in range(-(i // 2), i // 2 + 1):
            x, y = 18 + i, 22 + j + i // 3
            if g.get(x, y) in (P['cave0'], P['cave1'], P['cave2'], P['rock']) and (x + y) % 2 == 0:
                g.set(x, y, 'beam')
    for y in range(19, 21):
        g.set(15, y, 'beam')  # Seil
    g.sprite(12, 21, EXPLORER, EXPLORER_KEY)
    return g


VARIANTS = {'a': variant_a, 'b': variant_b, 'c': variant_c}


# ---------------------------------------------------------------- Ausgabe

def write_icons(make):
    out = os.path.join(ROOT, 'public', 'icons')
    os.makedirs(out, exist_ok=True)
    make(32).image(6).save(os.path.join(out, 'icon-192.png'))
    make(32).image(16).save(os.path.join(out, 'icon-512.png'))
    # maskable: gleiches Bild (Motiv liegt in der inneren 75 %-Zone, Rand vollflächig)
    make(32).image(16).save(os.path.join(out, 'icon-maskable-512.png'))
    make(32).image(6).save(os.path.join(out, 'icon-maskable-192.png'))
    # Apple: 180 = 36×5, ohne Transparenz
    make(36).image(5).convert('RGB').save(os.path.join(ROOT, 'public', 'apple-touch-icon.png'))
    make(32).image(1).save(os.path.join(ROOT, 'public', 'favicon-32.png'))
    make(32).image(2).save(os.path.join(ROOT, 'public', 'favicon-64.png'))
    print('geschrieben: public/icons/icon-{192,512,maskable-192,maskable-512}.png, public/apple-touch-icon.png, public/favicon-{32,64}.png')


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def preview():
    """Alle Varianten in Homescreen-Größe: hell/dunkel, rund/abgerundet, 48 und 64 px."""
    cell, pad = 80, 16
    rows = []
    for bg in ('#f2efe8', '#101014'):
        for shape in ('round', 'squircle'):
            rows.append((bg, shape))
    sizes = (48, 64)
    W = pad + len(VARIANTS) * (len(sizes) * cell + pad * 2)
    H = 40 + len(rows) * (cell + 8) + pad
    sheet = Image.new('RGB', (W, H), '#2a2a30')
    d = ImageDraw.Draw(sheet)
    for vi, (name, make) in enumerate(VARIANTS.items()):
        x0 = pad + vi * (len(sizes) * cell + pad * 2)
        d.text((x0, 12), f'Variante {name.upper()}', fill='#ffffff')
        src = make(32).image(6)  # 192 px, wie ein Launcher es bekommt
        for ri, (bg, shape) in enumerate(rows):
            y0 = 40 + ri * (cell + 8)
            d.rectangle([x0 - 8, y0 - 4, x0 + len(sizes) * cell, y0 + cell - 4], fill=bg)
            for si, s in enumerate(sizes):
                # Launcher skalieren mit Filter herunter – genau so sieht es auf dem Homescreen aus
                ic = src.resize((s, s), Image.LANCZOS)
                mask = Image.new('L', (s, s), 0)
                if shape == 'round':
                    ImageDraw.Draw(mask).ellipse([0, 0, s - 1, s - 1], fill=255)
                else:
                    mask = rounded_mask(s, int(s * 0.22))
                sheet.paste(ic, (x0 + si * cell + (cell - s) // 2 - 8, y0 + (cell - s) // 2 - 4), mask)
    os.makedirs(os.path.join(ROOT, 'screenshots'), exist_ok=True)
    path = os.path.join(ROOT, 'screenshots', 'icon-preview.png')
    sheet.save(path)
    # zusätzlich die Rohsprites groß (8×) zum Begutachten
    big = Image.new('RGB', (len(VARIANTS) * (32 * 8 + 16) + 16, 32 * 8 + 32), '#2a2a30')
    for vi, make in enumerate(VARIANTS.values()):
        big.paste(make(32).image(8), (16 + vi * (32 * 8 + 16), 16))
    big.save(os.path.join(ROOT, 'screenshots', 'icon-sprites.png'))
    print('Vorschau: screenshots/icon-preview.png, screenshots/icon-sprites.png')


if __name__ == '__main__':
    args = sys.argv[1:]
    v = next((a.split('=')[1] for a in args if a.startswith('--variant=')), VARIANT)
    if '--preview' in args:
        preview()
    write_icons(VARIANTS[v])
