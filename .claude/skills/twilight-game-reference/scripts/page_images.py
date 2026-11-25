# List <img> sources (lazy data-src aware) with alt text from a saved HTML page.
# Usage: python3 -I page_images.py page.html ["alt regex"]
import html, re, sys

s = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
pat = re.compile(sys.argv[2], re.I) if len(sys.argv) > 2 else None
seen = set()
for m in re.finditer(r"<img[^>]+>", s):
    t = m.group(0)
    src = re.search(r'data-src="([^"]+)"', t) or re.search(r'\ssrc="([^"]+)"', t)
    alt = re.search(r'alt="([^"]*)"', t)
    a = html.unescape(alt.group(1)) if alt else ""
    if src and not src.group(1).startswith("data:") and (not pat or pat.search(a)) and src.group(1) not in seen:
        seen.add(src.group(1)); print(a[:60], "|", src.group(1))
