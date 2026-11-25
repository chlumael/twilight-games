# Combine screenshots side by side into one image (for sending several at once).
# Usage: python3 -I sheet.py out.png a.png b.png ... [--max 2000]
import sys
from PIL import Image

args = sys.argv[1:]
maxw = 2000
if "--max" in args:
    i = args.index("--max"); maxw = int(args[i + 1]); del args[i:i + 2]
out, files = args[0], args[1:]
ims = [Image.open(f).convert("RGB") for f in files]
h = max(i.height for i in ims)
w = sum(i.width for i in ims) + 10 * (len(ims) - 1)
sheet = Image.new("RGB", (w, h), (40, 40, 40))
x = 0
for im in ims:
    sheet.paste(im, (x, 0)); x += im.width + 10
sheet.thumbnail((maxw, maxw))
sheet.save(out)
print(out, sheet.size)
