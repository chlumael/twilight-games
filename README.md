# 황혼 게임즈

가챠 게임(원신, 명일방주, 명일방주: 엔드필드, 림버스 컴퍼니) 화면을 읽어 재화·천장·결과를 자동으로 기록하는 윈도우 오버레이 앱입니다.

- 게임 메모리·통신·계정에 접근하지 않고, 게임 창 화면만 캡처해서 인식합니다.
- 모든 기록은 PC 안에만 저장되며 외부로 전송되지 않습니다.

현재 설계 단계입니다. 자세한 내용은 [DESIGN.md](DESIGN.md)를 참고하세요.

## 설치

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
