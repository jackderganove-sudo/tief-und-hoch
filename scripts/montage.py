# python3 scripts/montage.py out.png scale file1 file2 ...  – Screenshots nebeneinander
import sys
from PIL import Image, ImageDraw
out, scale, files = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in files]
ims = [im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in ims]
W = sum(i.width for i in ims) + 6 * (len(ims) - 1)
H = max(i.height for i in ims) + 14
sheet = Image.new('RGB', (W, H), (20, 20, 20))
d = ImageDraw.Draw(sheet)
x = 0
for f, im in zip(files, ims):
    sheet.paste(im, (x, 14))
    d.text((x + 2, 1), f.split('/')[-1].replace('.png', '')[-22:], fill=(255, 255, 0))
    x += im.width + 6
sheet.save(out)
