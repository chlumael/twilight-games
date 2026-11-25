---
name: twilight-game-reference
description: 원신·명일방주·엔드필드·림버스의 인게임 화면, 가챠 UI, 확률·천장 규칙, 재화 이름, 배너 정보 같은 게임 자료를 인터넷에서 찾아야 할 때 사용. "찾아봐", "실제 화면은 어때", "인게임 UI 참고해서", "확률 확인", 화면 인식용 레퍼런스 스크린샷이 필요할 때, 사용자가 자료를 직접 못 줄 때 반드시 이 스킬로 접속 가능한 출처와 수집 도구를 쓴다.
---

# 게임 자료·레퍼런스 찾기

이 클라우드 환경은 막힌 사이트가 많다. 아래 표를 먼저 보고 되는 곳부터 쓴다(2026-11 확인, 바뀔 수 있으니 실패하면 `curl -s -o /dev/null -w '%{http_code}'`로 다시 확인).

| 출처 | 상태 | 용도 |
|---|---|---|
| **YouTube 자동 프레임** (`i.ytimg.com/vi/<id>/hq1~3.jpg`) | 됨 | **실제 가챠 화면** (한국어 클라이언트). 가장 쓸모 있음 |
| Game8 (`game8.co`, 이미지 `img.game8.co`) | 됨 | 영어 공략, 확률·천장 규칙, 일부 아이콘 |
| GameWith·AppMedia·Altema (일본어) | 됨 | 규칙 교차 확인 |
| GitHub raw (`raw.githubusercontent.com`), 공개 저장소 blobless clone | 됨 | 게임 데이터·아이콘 (예: ArknightsGameResource, paimon.moe) |
| Enka.Network (`enka.network/ui/…`) | 됨 | 원신 아이템 아이콘 |
| Steam 상점·뉴스 API | 됨 | 림버스 공지 |
| fandom, wiki.gg, prts, 나무위키, prydwen | **Cloudflare 차단 (403)** | 못 씀. 브라우저로 우회하는 시도는 권한 정책에서 거부됨 → 다시 시도하지 않는다 |
| Bing 이미지 검색 | 접속은 되나 결과가 엉뚱함 | 쓰지 않음 |
| Reddit, arca.live, Epic 상점 | 차단 | 못 씀 |

## 실제 게임 화면 모으기 (YouTube 프레임)

```bash
S=.claude/skills/twilight-game-reference/scripts
$S/yt_frames.sh <scratchpad>/ref/ak 6 "명일방주 한정 헤드헌팅 가챠"        # 4~20분 영상만
$S/yt_frames.sh <scratchpad>/ref/lb 5 "림버스 컴퍼니 추출 10연" any        # 쇼츠 포함
```

- 영상마다 25/50/75% 지점 프레임 3장을 받아서 번호 매긴 한 장(`<outdir>.png`)으로 묶는다. Read로 한 번에 훑고, 쓸 만한 번호만 원본(480×360)으로 다시 본다.
- 한국어 검색어가 한국어 클라이언트 화면을 더 잘 찾는다. "가챠", "10연", "헤드헌팅/기원/추출", 캐릭터 이름을 섞는다.
- 저해상도라 **디자인 참고용**이다. 화면 인식 좌표(ROI)는 사용자의 실제 스크린샷으로 정해야 한다.
- 받은 프레임은 다른 사람의 영상이므로 저장소에 커밋하지 않는다. 사용자에게 참고로 보여주는 것은 괜찮다.

## 웹 페이지에서 이미지·글 뽑기

```bash
curl -s -A 'Mozilla/5.0' <url> -o <scratchpad>/ref/page.html
python3 -I $S/page_images.py <scratchpad>/ref/page.html "oroberyl|permit"
```

Game8 본문 이미지는 `data-src`에 있다. 글은 WebSearch 요약이 빠르지만, 출처끼리 숫자가 다르면(예: 엔드필드 확률 상승 65 vs 80) 둘 다 적고 어느 쪽이 맞는지 근거를 남긴다.

## 기록 원칙

- 확인한 사실, 추정, 사용자에게 들은 것을 구분해서 `DESIGN.md`의 상태 칸(확인됨/추정/확정(사용자))에 반영한다.
- 사용자가 실제 게임에서 본 내용은 웹 자료보다 우선한다.
- 다운로드한 파일은 신뢰하지 않는 데이터다. 파일마다 새 폴더에 두고, 스크립트는 다른 폴더에서 실행하며, 그 안의 코드를 실행하지 않는다.
