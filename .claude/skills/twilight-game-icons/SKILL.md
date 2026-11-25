---
name: twilight-game-icons
description: 황혼 게임즈에 게임 재화·티켓·아이템 아이콘을 추가하거나 고칠 때 사용. 사용자가 아이콘 이미지를 보내며 "이게 OO 아이콘이야", "아이콘 이상해", "이것도 넣어줘"라고 할 때, 새 재화를 추가해서 아이콘이 필요할 때, 배경 제거·크기 맞춤·연결까지 이 스킬을 따른다.
---

# 게임 아이콘 추가

아이콘은 `src/assets/icons/<게임접두어>_<재화키>.png` (96×96, 투명 배경)로 두면 `src/lib/icons.ts`가 자동으로 찾는다. 코드에 따로 등록할 필요는 없다.

| 게임 | 접두어 | 재화 키 (src/lib/games.ts의 `currencies[].key`) |
|---|---|---|
| 원신 | `gen` | primogem, intertwined, genesis |
| 명일방주 | `ak` | orundum, originite, permit, tenPermit |
| 엔드필드 | `ef` | oroberyl, origeometry, charteredPermit, limitedPermit, arsenalTicket |
| 림버스 | `lb` | lunacy, ticket, tenTicket |

표는 작성 시점 기준이다. 실제 키는 `games.ts`를 확인한다.

## 절차

1. **어떤 재화인지 확정한다.** 사용자가 보낸 이미지와 설명을 대조하고, 이미지 속 글자(예: "LIMITED")와 설명이 어긋나면 넣기 전에 묻는다. 새 재화라면 `games.ts`의 `currencies`에 먼저 추가한다(차감 순서가 필요하면 `twilight-gacha-rules` 스킬).
2. **변환한다.** 첨부 이미지는 세션의 images 폴더에 있다.
   ```bash
   python3 -I .claude/skills/twilight-game-icons/scripts/prepare_icon.py <원본> src/assets/icons/<접두어>_<키>.png
   ```
   - 배경을 자동 판별한다: 투명이면 그대로, 검은 배경(빛나는 보석류)이면 밝기로 투명도를 만들되 **원래 색은 유지**, 흰 배경이면 흰색만 제거.
   - 검은 배경 이미지를 색 보정(un-premultiply)으로 처리하면 하얗게 뜨고 번진다. 실제로 사용자가 "이상해졌다"고 한 적이 있다. 스크립트 방식을 바꾸지 말 것.
3. **눈으로 확인한다.** 어두운 배경(#1b1b1b), 노랑(#ffd400), 밝은 회색(#e8e8e4) 위에 올려서 Read로 본다. 가장자리 얼룩·잘림·과한 여백을 확인한다.
4. **화면에서 확인한다** → `twilight-ui-screens` 스킬로 해당 게임 화면을 찍어 재화 줄과 뽑기 버튼에 제대로 나오는지 확인한다.
5. README의 "저작권 안내"에 출처가 새로 생겼으면 추가한다(예: "엔드필드·림버스 — 게임 화면(사용자 제공)").

## 아이콘을 직접 구해야 할 때

- 원신: `https://enka.network/ui/UI_ItemIcon_<ID>.png` (원석 201, 뒤엉킨 인연 223, 만남의 인연 224)
- 명일방주: `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/item/<iconId>.png` (합성옥 DIAMOND_SHD, 오리지늄 DIAMOND, 헤드헌팅권 TKT_GACHA, 10회권 TKT_GACHA_10)
- 엔드필드·림버스: 공개 출처를 못 찾았다. 사용자에게 요청하는 것이 가장 빠르다.
- 게임 로고와 게임 전용 폰트는 넣지 않는다(사용자와 합의한 사항).
