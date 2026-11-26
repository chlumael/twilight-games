#!/usr/bin/env python3
"""원신 공식 기원 상세(게임 안 '상세' 화면과 같은 자료)를 받아 규칙 글과 5성 목록을 저장한다.

사용법: python3 -I genshin_wish_details.py <outDir>
결과: <outDir>/<기원 종류 번호>.txt (규칙 글), 화면에는 기원별 픽업·5성 목록 요약.
기원 종류 번호: 200 일반, 301·400 캐릭터 이벤트 1·2, 302 무기 이벤트, 500 묶음 기원.
지금 열려 있는 기원만 나온다.
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://operation-webstatic.hoyoverse.com/gacha_info/hk4e/os_asia"
if len(sys.argv) < 2:
    sys.exit("usage: python3 -I genshin_wish_details.py <outDir>")
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "banner-pack"}), timeout=40) as r:
        return json.load(r)


for g in get(f"{BASE}/gacha/list.json")["data"]["list"]:
    d = get(f"{BASE}/{g['gacha_id']}/ko-kr.json")
    title = re.sub("<[^>]+>", "", d.get("title") or "")
    text = re.sub(r"\n\s*", "\n", html.unescape(re.sub("<[^>]+>", "\n", d.get("content") or "")))
    # 한 문장이 여러 줄로 쪼개져 나오므로 읽기 좋게 이어 붙인다(제목 줄 〓, [, ※ 앞에서만 줄을 바꾼다)
    joined = re.sub(r"\n(?![〓\[※])", " ", text).strip()
    (out / f"{g['gacha_type']}.txt").write_text(f"{title}\n{g['begin_time']} ~ {g['end_time']}\n\n{joined}\n")
    r5 = d.get("r5_prob_list") or []
    print(f"== {g['gacha_type']} {title} ({g['begin_time']} ~ {g['end_time']})")
    print("   5성 기본", d.get("r5_prob"), "천장 포함", d.get("r5_baodi_prob"), "픽업 비율", d.get("r5_up_prob"))
    print("   픽업:", ", ".join(i["item_name"] for i in r5 if i.get("is_up")) or "(없음)")
    print("   그 밖 5성:", ", ".join(i["item_name"] for i in r5 if not i.get("is_up")))
