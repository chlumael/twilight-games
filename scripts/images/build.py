#!/usr/bin/env python3
"""게임 이미지 모음 만들기 (사용자 허용 2026-11-27: 캐릭터·무기·게임 아이콘, 배너 그림).

각 게임의 공개 자료에서 이미지를 받아 작게 줄인 사본(webp)을 data/images/에 두고,
한국어 이름 → 파일, 배너 id → 파일 목록(data/images/index.json)을 만든다. 앱은 이 목록과 파일을
저장소 main에서 받아 쓴다(앱 업데이트 없이 반영).

- 받은 파일은 그림으로만 연다(실행하지 않는다). 이미 있는 파일은 다시 받지 않는다.
- 아이콘은 96×96, 배너 그림은 가로 480으로 줄인다.
- 출처를 못 받은 것은 건너뛰고 경고만 남긴다(이미지가 없어도 앱은 글자로 보여 준다).

사용: python3 -I scripts/images/build.py [--only genshin,arknights] [--pack data/banners.new.json]
"""
import hashlib
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "images"
PACK = ROOT / "data" / "banners.json"
UA = {"User-Agent": "twilight-games-image-builder"}
ICON = 96
BANNER_W = 480
warnings: list[str] = []


def get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def slug(text: str) -> str:
    """파일 이름: 영문 id는 그대로, 한글 등은 짧은 해시로"""
    s = re.sub(r"[^a-z0-9_-]+", "-", text.lower()).strip("-")
    if s and s == text.lower():
        return s[:60]
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def save(rel: str, url: str, kind: str) -> bool:
    """url의 그림을 받아 data/images/<rel>로 줄여 저장. 이미 있으면 받지 않는다"""
    path = OUT / rel
    if path.exists():
        return True
    try:
        img = Image.open(io.BytesIO(get(url)))
        img.load()
    except Exception as e:  # 받지 못했거나 그림이 아님
        warnings.append(f"{rel}: {e} ({url})")
        return False
    img = img.convert("RGBA")
    if kind == "portrait":  # 세로로 긴 상반신 그림: 위쪽(얼굴) 정사각형만
        side = min(img.width, img.height)
        img = img.crop(((img.width - side) // 2, 0, (img.width - side) // 2 + side, side))
        kind = "icon"
    if kind == "icon":
        img.thumbnail((ICON, ICON), Image.LANCZOS)
        canvas = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
        canvas.paste(img, ((ICON - img.width) // 2, (ICON - img.height) // 2), img)
        img, quality = canvas, 82
    else:
        if img.width > BANNER_W:
            img = img.resize((BANNER_W, round(img.height * BANNER_W / img.width)), Image.LANCZOS)
        img, quality = img.convert("RGB"), 72
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6)
    return True


# ── 원신: paimon.moe 저장소(캐릭터·무기 아이콘, 배너 그림) ──────────────────────────
PAIMON = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main"


def paimon_table(src: str) -> dict[str, tuple[str, int]]:
    """`key: { ... name: '...', rarity: N }` 표를 글로 읽는다 → id: (영어 이름, 등급)"""
    out = {}
    for m in re.finditer(r"^ {2}['\"]?([\w-]+)['\"]?: \{([\s\S]*?)^ {2}\}", src, re.M):
        n = re.search(r"^ {4}name: (['\"])((?:\\.|(?!\1).)*)\1", m.group(2), re.M)
        r = re.search(r"^ {4}rarity: (\d)", m.group(2), re.M)
        if n and r:
            out[m.group(1)] = (re.sub(r"\\(.)", r"\1", n.group(2)), int(r.group(1)))
    return out


def genshin() -> dict[str, str]:
    ko = json.loads(get(f"{PAIMON}/src/locales/items/ko.json"))
    items: dict[str, str] = {}
    for table, folder in (("weaponList", "weapons"), ("characters", "characters")):  # 같은 이름이면 캐릭터가 이긴다
        for pid, (en, rarity) in paimon_table(get(f"{PAIMON}/src/data/{table}.js").decode()).items():
            name = ko.get(en)
            if not name or rarity < 4:
                continue
            rel = f"genshin/i/{slug(pid)}.webp"
            if save(rel, f"{PAIMON}/static/images/{folder}/{pid}.png", "icon"):
                items[name] = rel
    return items


# ── 명일방주: 한국 서버 게임 데이터(이름) + ArknightsGameResource(얼굴 아이콘) ──────────
AK_TABLE = "https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_YoStar/main/ko_KR/gamedata/excel/character_table.json"
AK_AVATAR = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar"


def arknights() -> dict[str, str]:
    table = json.loads(get(AK_TABLE, timeout=180))
    items: dict[str, str] = {}
    for cid, c in table.items():
        if not cid.startswith("char_") or c.get("isNotObtainable"):
            continue
        r = c.get("rarity")
        rarity = int(r.replace("TIER_", "")) if isinstance(r, str) else int(r or 0) + 1
        name = c.get("name")
        if rarity < 4 or not name:
            continue
        rel = f"arknights/i/{slug(cid)}.webp"
        if save(rel, f"{AK_AVATAR}/{cid}.png", "icon"):
            items[name] = rel
    return items


# ── 엔드필드: 공식 한국어 홈페이지(오퍼레이터 그림) + 공개 저장소(무기 이름·아이콘) ─────────
EF_OPERATORS = "https://endfield.gryphline.com/ko-kr/operator"
EF_WEAPONS = "https://raw.githubusercontent.com/MaaEnd/MaaEnd/HEAD/tools/zmdmap/data/weapons.json"
EF_WEAPON_ICON = "https://raw.githubusercontent.com/Lieyuan621/Endaxis/HEAD/public/weapons"


def endfield() -> dict[str, str]:
    items: dict[str, str] = {}
    try:
        data = json.loads(get(EF_WEAPONS))
        for v in data.values():
            if not isinstance(v, dict):
                continue
            ko, icon = (v or {}).get("names", {}).get("KR"), (v or {}).get("icon_id")
            if not ko or not icon or not re.fullmatch(r"wpn_[a-z]+_\d+", icon) or int(v.get("rarity") or 0) < 4:
                continue
            rel = f"endfield/i/{slug(icon)}.webp"
            if save(rel, f"{EF_WEAPON_ICON}/{icon.split('_')[1]}/{icon}.webp", "icon"):
                items[ko] = rel
    except Exception as e:
        warnings.append(f"엔드필드 무기: {e}")
    # 오퍼레이터: 홈페이지 목록의 배경 그림 주소 + 한국어 이름 (같은 이름이면 오퍼레이터가 이긴다)
    html = get(EF_OPERATORS).decode("utf-8", "replace")
    pat = re.compile(r'data-key="([^"]+)" style="background-image:url\((https://[^)]+)\)"></div><div class="OperatorItem_contentBlock__\w+" data-rarity="(\d)">.*?nameText__\w+"[^>]*>([^<]+)</span>', re.S)
    for key, url, rarity, ko in pat.findall(html):
        if int(rarity) < 4 or ko in items and items[ko].startswith("endfield/o/"):
            continue
        rel = f"endfield/o/{slug(key)}.webp"
        if save(rel, url, "portrait"):
            items[ko.strip()] = rel
    return items


# ── 림버스: 게임 한국어 글 사본(LocalizeLimbusCompany, 이름↔id) + eldritchtools(인격·E.G.O 아이콘) ───
LLC = "https://raw.githubusercontent.com/LocalizeLimbusCompany/LocalizeLimbusCompany/main/KR"
ET = "https://limbus-assets.eldritchtools.com"


def limbus() -> dict[str, str]:
    from datetime import datetime, timedelta

    sinner = {c["id"]: c["name"] for c in json.loads(get(f"{LLC}/Characters.json"))["dataList"]}
    sid_of = {v: k for k, v in sinner.items()}
    ids = json.loads(get(f"{ET}/data/identities.json"))
    egos = json.loads(get(f"{ET}/data/egos.json"))
    norm = lambda t: re.sub(r"\s+", "", t)
    # 이름 → (종류, id): 인격은 "제목 이름", E.G.O는 "E.G.O 이름 + 수감자"
    found: dict[str, tuple[str, int]] = {}
    for x in json.loads(get(f"{LLC}/Personalities.json"))["dataList"]:
        if isinstance(x.get("id"), int) and x["id"] < 100000 and x.get("title"):
            found[f'{x["title"]} {x["name"]}'.replace("\n", " ")] = ("identities", x["id"])
    for x in json.loads(get(f"{LLC}/Egos.json"))["dataList"]:
        sn = sinner.get(int(str(x.get("id", 0))[1:3] or 0)) if isinstance(x.get("id"), int) and x["id"] < 100000 else None
        if sn and x.get("name"):
            found[f'{x["name"]} {sn}'.replace("\n", " ")] = ("egos", x["id"])
    by_norm = {norm(k): v for k, v in found.items()}
    # 한국어 글 사본에 아직 없는 새 인격·E.G.O: 배너의 수감자 + 배너 시작일(한국 시간)이 출시일과 같은 것이 하나뿐일 때만
    pack = json.loads(PACK.read_text("utf-8"))
    for b in pack.get("games", {}).get("limbus", []):
        kst = (datetime.fromisoformat(b["start"].replace("Z", "+00:00")) + timedelta(hours=9)).date().isoformat()
        for f in b.get("featured", []) + b.get("featuredRare", []):
            ko = f.get("ko") or ""
            if not ko or norm(ko) in by_norm:
                continue
            sn = next((x for x in sinner.values() if ko.endswith(" " + x)), None)
            ego = f.get("grade") not in ("000", "00", "0")
            src = egos if ego else ids
            hit = [k for k, v in src.items() if sn and v.get("sinnerId") == sid_of[sn] and v.get("date") == kst]
            if len(hit) == 1:
                found[ko] = ("egos" if ego else "identities", int(hit[0]))
                by_norm[norm(ko)] = found[ko]
    items: dict[str, str] = {}
    for name, (kind, i) in found.items():
        if kind == "identities" and str(i).endswith("01"):
            continue  # 기본 인격은 뽑기에 안 나온다
        file = f"{i}_normal_profile.webp" if kind == "identities" else f"{i}_awaken_profile.webp"
        rel = f"limbus/{kind[0]}/{i}.webp"
        if save(rel, f"{ET}/assets/{kind}/{file}", "icon"):
            items[name] = rel
    return items


SOURCES = {"genshin": genshin, "arknights": arknights, "endfield": endfield, "limbus": limbus}


def banners(game: str, pack: dict) -> dict[str, str]:
    """배너 팩에 그림 원본 주소(image)가 있는 배너 → 줄인 사본"""
    out = {}
    for b in pack.get("games", {}).get(game, []):
        url = b.get("image")
        if not url or not url.startswith("https://"):
            continue
        key = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        rel = f"{game}/b/{slug(key)}.webp"
        if save(rel, url, "banner"):
            out[b["id"]] = rel
    return out


def main() -> None:
    global PACK
    if "--pack" in sys.argv:
        PACK = Path(sys.argv[sys.argv.index("--pack") + 1]).resolve()
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    index_path = OUT / "index.json"
    old = json.loads(index_path.read_text("utf-8")) if index_path.exists() else {"games": {}}
    pack = json.loads(PACK.read_text("utf-8"))
    games = dict(old.get("games", {}))
    for game, fn in SOURCES.items():
        if only and game not in only:
            continue
        try:
            items = fn()
        except Exception as e:
            warnings.append(f"{game}: 아이콘 출처 실패 {e}")
            items = games.get(game, {}).get("items", {})  # 실패하면 지난 목록 유지
        games[game] = {"items": dict(sorted(items.items())), "banners": banners(game, pack)}
    index = {"schemaVersion": 1, "games": games}
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", "utf-8")
    for g, v in games.items():
        print(f"{g}: 아이콘 {len(v['items'])}개, 배너 그림 {len(v['banners'])}개")
    for w in warnings[:40]:
        print("경고:", w)


if __name__ == "__main__":
    main()
