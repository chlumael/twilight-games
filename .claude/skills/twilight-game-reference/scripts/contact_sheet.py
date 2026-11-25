# Numbered grid of images (3 per row) so one Read shows many candidates.
# Usage: python3 -I contact_sheet.py out.png img1 img2 ...
import sys
from PIL import Image, ImageDraw

out, files = sys.argv[1], sys.argv[2:]
W, H, cols = 480, 270, 3
rows = max(1, (len(files) + cols - 1) // cols)
sheet = Image.new("RGB", (W * cols, H * rows), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    try:
        im = Image.open(f).convert("RGB"); im.thumbnail((W, H))
    except Exception:
        continue
    x, y = (i % cols) * W, (i // cols) * H
    sheet.paste(im, (x, y)); d.rectangle([x, y, x + 26, y + 16], fill=(0, 0, 0)); d.text((x + 3, y + 2), str(i), fill=(255, 255, 0))
sheet.save(out)
print(out, f"{len(files)} images")
