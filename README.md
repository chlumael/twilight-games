# 황혼 게임즈

가챠 게임(원신, 명일방주, 명일방주: 엔드필드, 림버스 컴퍼니) 화면을 읽어 재화·천장·결과를 자동으로 기록하는 윈도우 오버레이 앱입니다.

- 게임 메모리·통신·게임 계정에 접근하지 않고, 화면만 보고 기록합니다.
- 로그인하지 않으면 기록은 기기 안에만 저장됩니다. 구글 계정으로 로그인하면 본인 계정(본인만 접근)에 동기화되어 앱을 지우거나 기기를 바꿔도 남습니다.
- 친구끼리 서로의 기록과 운 순위를 보는 기능은 마지막 단계에서 붙입니다 (공유를 켠 사람의 요약만 공개).

지금은 **안드로이드 앱**(게임 위에 떠 있는 막대·창)을 먼저 만들고 있습니다. 자세한 설계는 [DESIGN.md](DESIGN.md)를 참고하세요.

## 안드로이드 앱

[Releases](https://github.com/chlumael/twilight-games/releases)에서 최신 `twilight-games-x.y.z.apk`를 받아 설치합니다. 처음 한 번 "출처를 알 수 없는 앱" 설치를 허용해야 합니다. 이후 새 버전은 앱이 알려줍니다.

## 휴대폰에서 쓰기 (웹앱)

안드로이드 Chrome으로 https://chlumael.github.io/twilight-games/ 를 열고, 메뉴(⋮) → **홈 화면에 추가**를 누르면 앱처럼 쓸 수 있습니다. 기록은 그 휴대폰 브라우저에만 저장되니, 설정 → 백업 → 내보내기로 가끔 백업하세요.

## 설치 (PC)

[Actions](https://github.com/chlumael/twilight-games/actions) 탭에서 가장 최근의 성공한 `build` 실행을 열고, `twilight-games-windows` 파일을 내려받아 압축을 풀고 설치 파일을 실행합니다.
코드 서명이 없어서 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누르세요.

게임은 **테두리 없는 창모드**로 실행해야 오버레이가 위에 보입니다.

## 단축키

| 기능 | 키 |
|---|---|
| 클릭 통과 켜기/끄기 | Ctrl+Alt+T |
| 접기/펼치기 | Ctrl+Alt+H |
| 확인 대기 열기 | Ctrl+Alt+Q |
| 마지막 기록 되돌리기 | Ctrl+Alt+Z |

## 개발

필요: Node 22, Rust stable, (Windows) WebView2

```bash
npm install
npm run tauri dev   # 앱 실행
npm test            # 천장·재화 계산 테스트
npm run check       # 타입 검사
```

## 저작권 안내

재화 아이콘 등 게임 이미지의 저작권은 각 게임사(HoYoverse, Hypergryph/Yostar, GRYPHLINE, Project Moon)에 있습니다.
이 앱은 비상업 팬 도구이며 각 게임사와 관련이 없습니다. 게임 로고와 게임 전용 폰트는 포함하지 않습니다.
아이콘 출처: 원신 — Enka.Network, 명일방주 — [ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource), 엔드필드·림버스 — 게임 화면.
