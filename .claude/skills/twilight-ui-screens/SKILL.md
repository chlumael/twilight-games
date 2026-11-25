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

- 4개 게임 + 최고 등급 입력 창 + 설정 화면을 `<mode>-<이름>.png`로 저장한다.
- 콘솔 오류와 실패한 요청이 끝에 출력된다. 보내기 전에 고친다. 단, `raw.githubusercontent.com/.../main/data/banners.json` 404는 배너 팩이 아직 `main`에 없을 때 정상이다(앱에 들어 있는 팩을 대신 씀).
- 보내기 전에 Read로 직접 본다. 확인할 것: 글자 잘림·줄바꿈, 겹침, 스크롤해야만 보이는 버튼, 숫자가 계산상 맞는지(예: 원석 12480 + 창세 980 → 115회 가능).
- 시드 데이터는 `scripts/sample-data.json`. 새 재화·그룹을 추가했으면 여기에도 넣어야 화면에 나온다.

## 사용자에게 보낼 때

- 여러 장은 `sheet.py`로 1~2장으로 묶어서 보낸다(휴대폰에서 넘기기 편하게).
- 캡션에 무엇을 보여주는지 한 줄로 쓴다.
- 브라우저 재현이라 실제 기기와 다를 수 있는 점(글꼴, 반투명 배경, 안드로이드 창 손잡이 등)은 답변에 짧게 밝힌다.

## 디자인 규칙 (스킨을 고칠 때)

- 게임별 스킨은 `src/lib/themes.ts`(색·변수)와 `src/skins.css`(장식)에 있다. 컴포넌트 스타일은 변수(`--a1`, `--top`, `--panel` 등)만 쓰고, 게임 전용 장식은 `skins.css`에 `main[data-skin="게임"]`으로 넣는다.
- 각 스킨은 실제 인게임 가챠 화면을 참고한다(레퍼런스는 `twilight-game-reference` 스킬).
- 게임 로고와 게임 전용 폰트는 쓰지 않는다(저작권·라이선스). 재화 아이콘은 사용한다.
