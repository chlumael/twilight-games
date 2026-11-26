---
name: twilight-ui-screens
description: 황혼 게임즈 화면(UI)을 고친 뒤 스크린샷으로 확인하거나 사용자에게 보여줄 때 사용. 스킨·레이아웃·버튼·색·아이콘 배치 변경, "화면 보여줘", "UI 어떻게 바뀌었어", PC 오버레이/휴대폰 웹앱/안드로이드 오버레이 창 모습 확인, 사용자가 실기기를 못 쓰는 상황에서 화면을 미리 보여줘야 할 때 반드시 이 스킬로 빌드·시드 데이터·스크린샷을 처리한다.
---

# 화면 확인·스크린샷

실기기 없이도 브라우저(Playwright, 이미 설치됨)로 모든 모드의 화면을 재현할 수 있다. 사용자는 거의 휴대폰으로 확인하므로, 결과는 SendUserFile로 이미지를 보낸다.

## 모드

| 모드 | 무엇 | 빌드 |
|---|---|---|
| `mobile` | 휴대폰 웹앱 (Pixel 7 크기) | `npm run build:web` |
| `overlay` | 안드로이드 게임 위 펼친 창 (340×530, 브리지 흉내) | `npm run build:web` |
| `app` | 안드로이드 앱 화면 ("⧉ 띄우기" 버튼 포함) | `npm run build:web` |
| `desktop` | PC 오버레이 펼친 창 (360×620) | `npm run build:web` |
| `collapsed` | PC 오버레이 한 줄 모드 | `npm run build:web` |

## 절차

```bash
cd <repo>
npm run build:web
# 미리보기 서버 (이미 떠 있으면 생략). `vite preview`는 브라우저의 스크립트 요청을 404로 거절하는 일이 있어(2026-11-25 확인, 화면이 하얗게 나옴) 파이썬 서버를 쓴다.
S=<scratchpad>/serve; mkdir -p $S; ln -sfn $PWD/dist $S/twilight-games; (cd $S && python3 -m http.server 4175 >/dev/null 2>&1 &)
S=.claude/skills/twilight-ui-screens/scripts
node $S/screens.cjs mobile  <scratchpad>/shots
node $S/screens.cjs overlay <scratchpad>/shots
python3 -I $S/sheet.py <scratchpad>/shots/sheet.png <scratchpad>/shots/mobile-*.png
```

- 4개 게임 + 예측 패널 + 설정 화면을 `<mode>-<이름>.png`로 저장한다.
- 콘솔 오류와 실패한 요청이 끝에 출력된다. 보내기 전에 고친다. 단, `raw.githubusercontent.com/.../main/data/banners.json` 404는 배너 팩이 아직 `main`에 없을 때 정상이다(앱에 들어 있는 팩을 대신 씀).
- 보내기 전에 Read로 직접 본다. 확인할 것: 글자 잘림·줄바꿈, 겹침, 스크롤해야만 보이는 버튼, 숫자가 계산상 맞는지(예: 원석 12480 + 창세 980 → 115회 가능).
- 시드 데이터는 `scripts/sample-data.json`. 새 재화·그룹을 추가했으면 여기에도 넣어야 화면에 나온다.

## 눌러야 나오는 화면 찍기 (`flow.cjs`)

입력 폼, 배너 "자세히", 특정 탭, 저장한 뒤 모습처럼 **몇 번 눌러야 나오는 화면**은 스크립트를 새로 쓰지 말고 `flow.cjs`에 순서를 적어 준다(예전에는 그때마다 스크립트를 새로 썼다).

```bash
cat > <scratchpad>/flow.json <<'JSON'
{ "game": "endfield",
  "games": { "endfield": { "currency": { "oroberyl": 7765 },
    "sessions": [{ "group": "endfield-chartered", "count": 52, "minsAgo": 60, "tops": { "51": ["포그라니치니크", false] } }] } },
  "steps": [
    { "tab": "한정" },
    { "click": "button.binfo" }, { "shot": "detail", "at": "section.detail" }, { "click": "section.detail .close" },
    { "click": "button.addbtn" }, { "fill": ["form.add input.n", "58"] }, { "fill": ["form.add input.nm", "사"] },
    { "shot": "form", "at": "form.add" } ],
  "sheet": "result" }
JSON
node .claude/skills/twilight-ui-screens/scripts/flow.cjs <scratchpad>/flow.json <scratchpad>/shots
```

- `games`는 `sample-data.json`과 같은 형식이다(없는 게임은 빈 기록). `tops`의 키는 그 묶음 안에서 몇 번째인지(0부터), 값은 `[이름, 픽업 여부]`. `banner`를 비우면 앱이 지금 진행 중인 배너로 맞춘다. 특정 배너 규칙을 보려면 `currentBanner`와 `banner`에 배너 id(`data/banners.json`)를 적는다.
- 단계: `tab`(글자가 들어간 첫 버튼), `click`·`check`·`fill`(선택자), `shot`(`at` = 그 부분이 보이게 한 뒤 화면 전체, `only` = 그 부분만), `wait`.
- 단계가 실패하면 어느 단계인지 알리고 그때 화면을 `failed-step-N.png`로 남긴다.
- 자주 쓰는 선택자:

| 화면 | 선택자 |
|---|---|
| 배너 자세히 열기 / 닫기 | `button.binfo` / `section.detail .close` |
| 최고 등급 기록 폼 열기 | `button.addbtn` → `form.add` |
| 폼의 번째 칸 / 이름 칸 | `form.add input.n` / `form.add input.nm` |
| 이름 후보 단추 | `button.pick:has-text('이름')` |
| 체크 (교환·횟수만·긴급 모집) | `label.exch:has-text('글자') input` |
| 저장 | `form.add button.save` |
| 기록 줄 / 카운터 | `section.hits` / `section.counters` |
| 예측 펼치기 | `section.forecast button.head` |
| 설정 / 내 통계 / 친구 / 달력 | `[aria-label=설정]` / `button[title="내 통계"]` / `button[title=친구]` / `button[title=달력]` |

선택자가 안 맞으면 컴포넌트(`src/components/*.svelte`)에서 클래스 이름을 확인한다.

## 정돈 점검 (화면을 바꿀 때마다)

사용자가 원하는 것: 깔끔하고 정갈하게, 필요한 정보가 한눈에(2026-11-26, 참고로 보여 준 것은 "픽업지지" 달력). 규칙 전문은 DESIGN.md §8.0. 찍은 화면을 보며 확인한다:

- [ ] 새 기능이 아래 탭을 늘리지 않았다(홈·달력·내 통계·친구·설정 다섯 개 고정)
- [ ] 홈 첫 화면에 새 숫자·버튼을 올렸다면, 대신 내려간 것이 있다
- [ ] 화면에 설명 문장이 없다(이름과 값만)
- [ ] 글이 두세 줄로 깨지거나 가로로 넘치는 곳이 없다(390px 휴대폰, 340px 띄운 창)
- [ ] 같은 이름·숫자를 두 번 쓰지 않았다
- [ ] 새 부품을 만들지 않고 있는 칩·태그·카드·목록 줄을 썼다
- [ ] 네 게임 스킨 모두에서 글자가 읽힌다(밝은 원신 스킨에서 연한 글자 주의)

## 사용자에게 보낼 때

- 여러 장은 `sheet.py`로 1~2장으로 묶어서 보낸다(휴대폰에서 넘기기 편하게).
- 캡션에 무엇을 보여주는지 한 줄로 쓴다.
- 브라우저 재현이라 실제 기기와 다를 수 있는 점(글꼴, 반투명 배경, 안드로이드 창 손잡이 등)은 답변에 짧게 밝힌다.

## 디자인 규칙 (스킨을 고칠 때)

- 게임별 스킨은 `src/lib/themes.ts`(색·변수)와 `src/skins.css`(장식)에 있다. 컴포넌트 스타일은 변수(`--a1`, `--top`, `--panel` 등)만 쓰고, 게임 전용 장식은 `skins.css`에 `main[data-skin="게임"]`으로 넣는다.
- 각 스킨은 실제 인게임 가챠 화면을 참고한다(레퍼런스는 `twilight-game-reference` 스킬).
- 게임 로고와 게임 전용 폰트는 쓰지 않는다(저작권·라이선스). 재화 아이콘은 사용한다.
