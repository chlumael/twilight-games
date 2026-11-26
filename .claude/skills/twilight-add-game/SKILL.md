---
name: twilight-add-game
description: 황혼 게임즈에 새 가챠 게임(예: 붕괴 스타레일, 젠레스 존 제로)을 추가할 때 사용. "○○도 넣어줘", "게임 추가", "새 게임 지원"이라는 요청이면 반드시 이 스킬의 순서와 점검 목록을 따른다. 게임 추가는 공개 배포 뒤로 미뤄 두었다(사용자 2026-11-26) — 요청을 받으면 그 결정을 바꾸는 것인지 한 줄로 확인한다.
---

# 새 게임 추가

규칙·배너·스킨·화면 인식은 모두 게임별 **데이터**로 분리돼 있다. 게임 하나 = 아래 칸을 채우는 일. 계산·화면 코드에 게임 이름으로 분기(`if (game === "…")`)를 새로 넣지 않는다. 필요하면 규칙 항목(`games.ts`)을 하나 더 만든다.

## 0. 먼저 볼 것 (하루 안에 판단)

| 확인 | 방법 | 안 되면 |
|---|---|---|
| 배너 일정·픽업을 기계로 읽을 공식 출처가 있나 | 공식 공지 자료 주소·게임 데이터 공개 저장소를 curl로 (`twilight-game-reference` 표의 막힌 곳 제외) | 그림 공지뿐이면 명일방주처럼 글자 인식(rapidocr) + 사람 확인. 비용이 크므로 사용자에게 먼저 알린다 |
| 규칙 원문이 있나 | `twilight-rule-sources` | 공략 여러 곳 일치로 "확인됨(공략)", 한 곳뿐이면 "추정" |
| 공식 기록을 불러올 길이 있나 | 게임 안 기록 화면(화면 읽기) / 공식 기록 사이트 | 화면 읽기만 |
| 게임 메모리·통신에 손대야 하나 | — | **하지 않는다**(CLAUDE.md 원칙). 원신 기원 기록 같은 예외는 사용자 허락이 따로 필요 |

결과를 사용자에게 표로 먼저 보여 주고 진행한다.

## 1. 채울 곳

| 무엇 | 파일 | 참고 |
|---|---|---|
| 게임 id | `src/lib/types.ts`의 `GameId`, `src/lib/games.ts`의 `GAMES` | 짧은 영어 소문자 |
| 재화·차감 순서·천장·카운터·확률 | `src/lib/games.ts` | `twilight-gacha-rules` 절차(테스트 먼저) |
| 월정액·일일 과제 수입 | `src/lib/income.ts`의 `PASSES`, `ROUTINES` | 출처 확인한 값만, note에 출처 |
| 아이콘 | `src/assets/icons/<접두>_<재화>.png`, `src/lib/icons.ts`의 `PREFIX` | `twilight-game-icons` |
| 스킨 | `src/lib/themes.ts`, `src/skins.css` | 게임 로고·전용 폰트 금지 |
| 배너 수집 | `scripts/banners/<게임>-official.mjs` + `build.mjs` + `validate.mjs`의 그룹 목록 | `twilight-banner-pack` |
| 달력 일정 | `scripts/banners/events.mjs`에 수집 함수 | 이벤트·버전 |
| 6성(최고 등급) 이름 표 | `data/names/<게임>-*.json` (필요하면) | 공식 기록 화면 판별용 |
| 화면 인식 틀 | `data/screens/<게임>.json`, `docs/recognition-gaps.md` | 실제 스크린샷 필요(`twilight-screen-recognition`) |
| 동기화 | `src/lib/sync.ts`는 `GAME_IDS`를 돌므로 보통 그대로. Firestore 규칙(`firestore.rules`)의 게임 목록 확인 | |
| 문서 | DESIGN.md §5(게임 정의)·§6(천장 표)·§6-2(수입) | 상태(확인됨/추정) 표기 |

`GAME_IDS`를 도는 곳(동기화, 통계, 달력, 설정의 "내 게임")은 자동으로 따라온다. 새 게임은 **기본으로 "내 게임"에 넣지 않는다** — 기존 사용자의 위쪽 게임 줄이 늘어나지 않게, 설정에서 켜야 보이게 한다(`settings.ts`의 `shownGames`: 고른 게임이 있으면 그것만).

## 2. 점검

- [ ] `npm test`, `npm run check` 통과, 새 규칙마다 테스트
- [ ] `npm run banners` 후 그 게임 배너·일정이 진행 중 것까지 맞게 나옴
- [ ] `twilight-ui-screens`로 새 게임 홈·달력·통계·설정 화면을 찍어 "정돈 점검"(DESIGN.md §8.0)
- [ ] 기존 네 게임 화면이 바뀌지 않았다
- [ ] 다른 게임 기록·동기화에 영향 없음(동기화 테스트)
- [ ] 안내문(`android/RELEASE_NOTES.md` 주석)에 "○○ 추가(설정 → 내 게임에서 켜기)"

## 하지 말 것

- 출처 없는 확률·천장 숫자 넣기
- 게임 화면 이미지·로고·폰트를 저장소에 넣기(재화 아이콘만 예외)
- 한 번에 여러 게임 추가(한 게임씩 게시하고 안정되면 다음)
