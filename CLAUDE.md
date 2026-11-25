# 황혼 게임즈 (twilight-games)

가챠 게임(원신, 명일방주, 명일방주: 엔드필드, 림버스 컴퍼니)의 재화·천장·결과를 기록하는 트래커.
목표: 게임 화면을 읽고 스스로 판단해서 기록하는 오버레이. 수동 입력은 수정용.

## 사용자와 일하는 방식
- **항상 한국어로 답한다.** 영어로 답했다가 "못 알아먹는다"는 지적을 받은 적이 있다.
- 결론 먼저, 확인한 사실과 추정을 구분, 표 활용, 군더더기 없이.
- 사용자는 주로 **안드로이드 휴대폰**으로 확인한다. 결과물은 스크린샷·APK 파일로 보낸다.
- 개발 순서: 모바일(안드로이드) 먼저 → PC. 로드맵은 `DESIGN.md` §10.

## 구조
- `src/` Svelte 화면 (웹앱·PC·안드로이드 공용). 규칙 데이터 `src/lib/games.ts`, 계산 `src/lib/ledger.ts`, 배너 `src/lib/banners.ts`, 스킨 `src/lib/themes.ts` + `src/skins.css`
- `android/` Kotlin 앱: WebView로 화면을 띄우고 게임 위 버블/창(오버레이) 제공
- `src-tauri/` PC 오버레이 (Tauri 2)
- `data/banners.json` 배너 데이터 팩, `scripts/banners/` 생성·검증
- `DESIGN.md` 설계와 결정 사항의 원본. 결정이 바뀌면 여기부터 고친다.

## 작업별 스킬 (`.claude/skills/`)
| 작업 | 스킬 |
|---|---|
| APK 빌드·검증·전달 | twilight-android-build |
| 화면 스크린샷 확인·전달 | twilight-ui-screens |
| 재화 아이콘 추가 | twilight-game-icons |
| 재화·차감 순서·천장 규칙 변경 | twilight-gacha-rules |
| 배너 데이터 팩 갱신·엔드필드 이름 | twilight-banner-pack |
| 게임 자료·레퍼런스 찾기 | twilight-game-reference |
| 화면 인식·게임 감지 구현 | twilight-screen-recognition |
| 커밋·CI 확인·보고 | twilight-ship |

## 지켜야 할 것
- 게임 로고·게임 전용 폰트는 넣지 않는다. 재화 아이콘은 사용(README에 저작권 표기).
- 외부에서 받은 코드는 실행하지 않는다(데이터로만 파싱).
- `npm test`, `npm run check`가 통과해야 올린다.
