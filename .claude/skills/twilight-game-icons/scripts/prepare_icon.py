# Normalize a game icon to a 96x96 transparent PNG for src/assets/icons/.
# Usage: python3 -I prepare_icon.py <input> <out.png> [--bg auto|none|black|white] [--size 96]
#   auto : keep alpha if the image has any, else detect a black or white background
#   black: glow-on-black art (keeps original colours, alpha from brightness)
#   white: flat art on white (near-white pixels become transparent)
import sys
from PIL import Image

args = sys.argv[1:]
opt = {"--bg": "auto", "--size": "96"}
for k in list(opt):
    if k in args:
        i = args.index(k); opt[k] = args[i + 1]; del args[i:i + 2]
src, dst = args
size = int(opt["--size"])
im = Image.open(src).convert("RGBA")

def corners(img):
    w, h = img.size
    return [img.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]

mode = opt["--bg"]
if mode == "auto":
    cs = corners(im)
    if any(c[3] < 250 for c in cs):
        mode = "none"
    elif all(max(c[:3]) < 20 for c in cs):
        mode = "black"
    elif all(min(c[:3]) > 235 for c in cs):
        mode = "white"
    else:
        mode = "none"

px = im.load()
w, h = im.size
if mode == "black":
    # Alpha from brightness, colours untouched (un-premultiplying over-brightens glows).
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            a = min(255, int(max(0, max(r, g, b) - 6) * 2.2))
            px[x, y] = (r, g, b, a if a >= 30 else 0)
elif mode == "white":
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if min(r, g, b) > 245:
                px[x, y] = (r, g, b, 0)

# Crop to visible content (ignore faint specks), pad to a square, resize.
mask = im.getchannel("A").point(lambda v: 255 if v > 30 else 0)
bbox = mask.getbbox()
if bbox:
    im = im.crop(bbox)
side = int(max(im.size) * 1.04)
sq = Image.new("RGBA", (side, side))
sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
sq.resize((size, size), Image.LANCZOS).save(dst, optimize=True)
print(f"{dst}: bg={mode} from {w}x{h}")
