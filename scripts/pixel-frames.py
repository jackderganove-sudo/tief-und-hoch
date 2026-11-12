"""Erzeugt die 9-Slice-Rahmen der Pixel-Oberfläche (eigene Grafiken, Ansimuz-Palette).
   python3 scripts/pixel-frames.py  →  src/assets/pixel/frames/*.png"""
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'pixel', 'frames')
os.makedirs(OUT, exist_ok=True)

def hexc(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

def save(im, name):
    im.save(os.path.join(OUT, name + '.png'))

def panel(name, outline, ring, hi, sh, grain, inner, fill, fill_hi, nail=True, fill_alpha=255):
    S = 16
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    p = im.load()
    for y in range(S):
        for x in range(S):
            corner = (x in (0, S - 1)) and (y in (0, S - 1))
            if corner:
                continue
            edge = x == 0 or y == 0 or x == S - 1 or y == S - 1
            ringz = 1 <= x <= S - 2 and 1 <= y <= S - 2 and (x <= 4 or y <= 4 or x >= S - 5 or y >= S - 5)
            if edge:
                p[x, y] = hexc(outline)
            elif ringz:
                c = ring
                if y == 1 or x == 1:
                    c = hi
                if y >= S - 3 or x == S - 2:
                    c = sh
                if (x * 7 + y * 3) % 11 == 0 and 2 <= y <= S - 4:
                    c = grain
                p[x, y] = hexc(c)
            elif x == 5 or y == 5 or x == S - 6 or y == S - 6:
                p[x, y] = hexc(inner)
            else:
                # gleichmäßige Fläche: die Mitte wird per 9-Slice gestreckt – ein Glanzpixel
                # hier würde zu einem breiten hellen Streifen (sichtbare Kante im Panel)
                p[x, y] = hexc(fill, fill_alpha)
    # gerundete Innenecken des Rings
    for (x, y) in [(1, 1), (S - 2, 1), (1, S - 2), (S - 2, S - 2)]:
        p[x, y] = hexc(outline)
    if nail:
        for (x, y) in [(2, 2), (S - 4, 2), (2, S - 4), (S - 4, S - 4)]:
            p[x, y] = hexc('#c8ccd4')
            p[x + 1, y] = hexc('#6d6875')
            p[x, y + 1] = hexc('#6d6875')
            p[x + 1, y + 1] = hexc('#45404d')
    save(im, name)

# Holzrahmen mit Pergament (Himmel/Startseite)
panel('wood', '#2a1810', '#a26c33', '#d7a45a', '#6e4423', '#8a5a2e', '#5a3a20', '#f3e2bb', '#e2cb98')
# Steinrahmen mit dunklem, leicht durchscheinendem Inneren (Höhle)
panel('stone', '#0e0a16', '#4a4060', '#7a6e94', '#2a2438', '#5c5274', '#120c1c', '#1d1729', '#151020')

def button(name, outline, face, hi, lip, shade, pressed=False):
    W, H = 16, 18
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    p = im.load()
    top = 2 if pressed else 0  # gedrückt: Fläche rutscht nach unten
    lip_h = 1 if pressed else 3
    for y in range(top, H):
        for x in range(W):
            if (x in (0, W - 1)) and (y in (top, H - 1)):
                continue
            edge = x == 0 or x == W - 1 or y == top or y == H - 1
            if edge:
                p[x, y] = hexc(outline)
            elif y >= H - 1 - lip_h:
                p[x, y] = hexc(lip)
            elif y == top + 1 or (x == 1 and y < H - 1 - lip_h):
                p[x, y] = hexc(hi)
            elif x == W - 2:
                p[x, y] = hexc(shade)
            else:
                p[x, y] = hexc(face)
    if not pressed:
        p[2, top + 2] = hexc('#ffffff')
    save(im, name)

for nm, face, hi, lip, shade in [
    ('gold', '#f2b53a', '#ffe08a', '#a8661c', '#d99a2e'),
    ('teal', '#3fc6c0', '#a8f5ea', '#1f6f76', '#34a8a6'),
    ('coral', '#e2603a', '#f7a07c', '#8e2f22', '#c44c30'),
    ('wood', '#b9803f', '#e0aa66', '#5e3a1c', '#9c6a32'),
    ('stone', '#5c5274', '#8a7eaa', '#241e33', '#4a4060'),
    ('violet', '#6b6fe8', '#a9acff', '#2c2f8a', '#5458c8'),
]:
    button('btn-' + nm, '#1b1424', face, hi, lip, shade)
    button('btn-' + nm + '-down', '#1b1424', face, hi, lip, shade, pressed=True)

def field(name, outline, face, inset, hi):
    S = 10
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    p = im.load()
    for y in range(S):
        for x in range(S):
            if (x in (0, S - 1)) and (y in (0, S - 1)):
                continue
            if x == 0 or y == 0 or x == S - 1 or y == S - 1:
                p[x, y] = hexc(outline)
            elif y == 1 or x == 1:
                p[x, y] = hexc(inset)
            elif y == S - 2 or x == S - 2:
                p[x, y] = hexc(hi)
            else:
                p[x, y] = hexc(face)
    save(im, name)

field('field-light', '#2a1810', '#fff7e3', '#d9c08c', '#ffffff')
field('field-dark', '#0e0a16', '#0f0a18', '#000000', '#3a3150')
print('ok', sorted(os.listdir(OUT)))
