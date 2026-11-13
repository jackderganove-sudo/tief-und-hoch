"""
Schneidet die im Spiel verwendeten Ausschnitte aus den Original-Packs in
assets/_downloads (nicht im Repo) und legt sie unter src/assets/pixel/{hell,heaven,space}/ ab.
Lizenzen siehe assets/CREDITS.md.

  python3 scripts/extract-world-assets.py
"""
from pathlib import Path
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
DL = ROOT / 'assets/_downloads'
OUT = ROOT / 'src/assets/pixel'


def src(p):
    return Image.open(DL / p).convert('RGBA')


def bbox_crop(im, box):
    """Ausschnitt auf den sichtbaren Inhalt verkleinern."""
    c = im.crop(box)
    b = c.getbbox()
    return c.crop(b) if b else c


def gif_strip(p):
    frames = [f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(DL / p))]
    w, h = frames[0].size
    strip = Image.new('RGBA', (w * len(frames), h))
    for i, f in enumerate(frames):
        strip.paste(f, (i * w, 0))
    return strip


def save(im, rel):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    print(f'{rel:32} {im.size}')


G = 'oga/grotto-escape-ii-environment/Grotto-escape-2-files_0/Grotto-escape-2-files/PNG/'
M = 'oga/magic-cliffs-environment/Magic-Cliffs-Environment/Magic-Cliffs-Environment/PNG/'
S = 'oga/space-background-3/space_background_pack/space_background_pack/layers/'

# ---------------------------------------------------------------- Hölle
save(src(G + 'animated/spritesheets/lava-fall.png'), 'hell/lavafall.png')  # 3 Frames 16x16 (ansimuz, CC-BY 3.0)
save(src(G + 'animated/spritesheets/lava.png'), 'hell/lavasurface.png')  # Lavaoberfläche, animiert
save(src('oga/16x16-and-animated-lava-tile-45-frames/lava_spr_strip45.png'), 'hell/lavatile.png')  # 45 Frames 16x16 (CC0)
demons = src('oga/red-demons-animated-classic-hero-edit/Demon-2-Sheet.png')
imp = Image.new('RGBA', (36, 20))
imp.paste(bbox_crop(demons, (8, 6, 28, 30)), (0, 2))   # stehend
imp.paste(bbox_crop(demons, (88, 6, 108, 30)), (18, 2))  # winkt (Arme oben)
save(imp, 'hell/imp.png')
save(src('oga/smoke-fire-animated-particle-16x16/Smoke_%26_Fire.png'), 'hell/smoke-fire.png')  # CC-BY 3.0
save(gif_strip('oga/16x16-torch/16x16_torch.gif'), 'hell/torch.png')
save(bbox_crop(src('oga/misc-dark-fantasy-scenery-sprites/misc_scenery.png'), (76, 6, 86, 44)), 'hell/chain.png')
save(src('oga/tiny-magic-glyphs/glyphs-outlined-noglow-alpha.png'), 'hell/glyphs.png')

# ---------------------------------------------------------------- Himmel
cliffs = src(M + 'tileset.png')
save(bbox_crop(cliffs, (36, 20, 142, 100)), 'heaven/island-big.png')
save(bbox_crop(cliffs, (42, 114, 100, 162)), 'heaven/island-small.png')
save(bbox_crop(cliffs, (530, 50, 574, 94)), 'heaven/rock-a.png')
save(bbox_crop(cliffs, (594, 50, 654, 94)), 'heaven/rock-b.png')
save(src(M + 'clouds.png'), 'heaven/clouds.png')
temple = src('oga/classical-temple-tiles/classical_temple_tiles.png')
save(bbox_crop(temple, (600, 576, 804, 756)), 'heaven/temple.png')
save(bbox_crop(temple, (0, 384, 212, 482)), 'heaven/columns.png')
save(gif_strip('oga/angel/angel.gif'), 'heaven/angel.png')

# ---------------------------------------------------------------- Weltraum (über dem Himmel, endlos)
for name in ['backgound', 'stars', 'far-planets', 'ring-planet', 'big-planet']:
    save(src(S + f'parallax-space-{name}.png'), f'space/{name.replace("backgound", "background")}.png')
save(src('oga/pixel-planets/PixelPlanets.png'), 'space/planets.png')

# Planeten (Master484, CC0): Kästchen mit weißem Rahmen auf Schwarz → rund ausgeschnitten, 6 Sorten nebeneinander
pl = Image.open(DL / 'oga/pixel-planets/PixelPlanets.png').convert('RGBA')
picks = [(76, 70), (113, 144), (150, 181), (76, 218), (113, 255), (150, 292)]  # Erde, Fels, Ozean, Wüste, Eis, Gas
row = Image.new('RGBA', (32 * len(picks), 32))
for i, (x, y) in enumerate(picks):
    cell = pl.crop((x + 1, y + 1, x + 33, y + 33))
    d = cell.load()
    for yy in range(32):
        for xx in range(32):
            if (xx - 15.5) ** 2 + (yy - 15.5) ** 2 > 15.2 ** 2:
                d[xx, yy] = (0, 0, 0, 0)
    row.paste(cell, (i * 32, 0))
save(row, 'space/planets.png')
