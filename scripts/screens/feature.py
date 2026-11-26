"""화면 판단용 특징값(모양 지문 + 평균 색) 만들기 — 스크린샷으로 data/screens/*.json의 빈칸을 채울 때 쓴다.

src-tauri/src/regions.rs 의 feature()와 똑같이 계산한다(바꾸면 둘 다 바꾸고 self_test 값도 맞출 것).
스크린샷은 저장소에 넣지 않는다. 결과(16자리 지문, 평균 색)만 JSON에 적는다.

사용:
  python3 scripts/screens/feature.py <스크린샷.png> <x> <y> <너비> <높이> [--aspect 1.7778]
  (x, y, 너비, 높이는 게임 화면 대비 비율 0~1)
  python3 scripts/screens/feature.py --self-test
"""
import math
import sys
from PIL import Image


def content_rect(w, h, aspect):
    if aspect and aspect > 0 and h > 0:
        if w / h > aspect:
            cw = h * aspect
            return ((w - cw) / 2, 0.0, cw, float(h))
        ch = w / aspect
        return (0.0, (h - ch) / 2, float(w), ch)
    return (0.0, 0.0, float(w), float(h))


def rect_px(w, h, content, r):
    cx, cy, cw, ch = content
    x0 = max(0, int(math.floor(cx + r[0] * cw + 0.5)))
    y0 = max(0, int(math.floor(cy + r[1] * ch + 0.5)))
    x1 = min(w, int(math.floor(cx + (r[0] + r[2]) * cw + 0.5)))
    y1 = min(h, int(math.floor(cy + (r[1] + r[3]) * ch + 0.5)))
    return (x0, y0, x1, y1)


def feature(img, area):
    """img: RGB PIL 이미지, area: (x0, y0, x1, y1) 픽셀"""
    x0, y0, x1, y1 = area
    px = img.load()
    W, H = img.size
    cells = []
    for cy in range(8):
        for cx in range(8):
            ax = x0 + (x1 - x0) * cx // 8
            bx = max(x0 + (x1 - x0) * (cx + 1) // 8, ax + 1)
            ay = y0 + (y1 - y0) * cy // 8
            by = max(y0 + (y1 - y0) * (cy + 1) // 8, ay + 1)
            s = n = 0
            for y in range(ay, min(by, H)):
                for x in range(ax, min(bx, W)):
                    r, g, b = px[x, y][:3]
                    s += 0.114 * b + 0.587 * g + 0.299 * r
                    n += 1
            cells.append(s / n if n else 0.0)
    mean = sum(cells) / 64
    bits = 0
    for i, v in enumerate(cells):
        if v >= mean:
            bits |= 1 << (63 - i)
    tr = tg = tb = n = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y][:3]
            tr += r; tg += g; tb += b; n += 1
    n = max(n, 1)
    return f"{bits:016x}", [tr // n, tg // n, tb // n]


def self_test():
    img = Image.new("RGB", (16, 16))
    for y in range(16):
        for x in range(16):
            c = 255 if x < 8 else 0
            img.putpixel((x, y), (c, c, c))
    h, rgb = feature(img, (0, 0, 16, 16))
    assert h == "f0f0f0f0f0f0f0f0", h
    assert rgb == [127, 127, 127], rgb
    print("ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        sys.exit(0)
    args = sys.argv[1:]
    aspect = 16 / 9
    if "--aspect" in args:
        i = args.index("--aspect")
        aspect = float(args[i + 1])
        args = args[:i] + args[i + 2:]
    path, *nums = args
    r = [float(v) for v in nums]
    img = Image.open(path).convert("RGB")
    area = rect_px(img.size[0], img.size[1], content_rect(img.size[0], img.size[1], aspect), r)
    h, rgb = feature(img, area)
    print(f'{{"rect": [{", ".join(f"{v:.4f}" for v in r)}], "hash": "{h}", "rgb": {rgb}}}')
