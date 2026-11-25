---
name: twilight-banner-pack
description: 황혼 게임즈의 배너 데이터 팩(data/banners.json)을 갱신·수정·검토할 때 사용. 새 픽업 배너 반영, "배너 안 나와", "배너 자동으로 안 바뀌어", 엔드필드 한국어 캐릭터 이름 추가, 주간 자동 PR 검토, 명일방주·림버스 배너 출처 추가, 배너 기간·픽업 이름 오류 수정 요청이면 반드시 이 스킬을 따른다.
---

# 배너 데이터 팩

앱은 `data/banners.json`(앱에 포함 + `main` 브랜치에서 최신본 다운로드)으로 진행 중 배너를 자동 선택하고 픽업 이름을 추천한다. 설계: `DESIGN.md` §6-1. 앱 쪽 로직: `src/lib/banners.ts`.

## 갱신

```bash
npm run banners        # build.mjs로 생성 → validate.mjs로 검증
git diff --stat data/banners.json
```

변경을 확인할 때는 diff 전체가 아니라 **지금 진행 중인 배너**를 뽑아 본다.

```bash
python3 -I -c "
import json,datetime
d=json.load(open('data/banners.json')); now=datetime.datetime.now(datetime.timezone.utc).isoformat()
for g,l in d['games'].items():
  for b in l:
    if (b['start'] or '')<=now<=(b['end'] or '9'): print(g,b['group'],b['name'],[f.get('ko') or f.get('en') or f.get('cn') for f in b['featured']])"
```

엔드필드도 2026-11-25부터 공식 공지에서 기간을 읽는다. 종료일이 `null`이면 "진행 중(종료일 미정)"이다.

## 출처별 주의

| 게임 | 출처 | 주의 |
|---|---|---|
| 원신 | paimon.moe (`banners.js`, `bannersDual.js`, `itemList.js`, `characters.js`, `weaponList.js`, `locales/items/ko.json`) | 시간은 아시아 서버(UTC+8). 캐릭터 배너는 두 5성이 모두 적혀 있어 `shortName`으로 자기 픽업만 남긴다. 기원 이름 한국어는 `genshin-official.mjs`가 게임 내 공식 공지(진행 중인 기원만 있음)에서 픽업 이름으로 맞춰 붙이고, 이전 팩의 한국어 이름을 이어받는다(원래 이름은 `nameEn`) |
| 엔드필드 | 한국어 공식 공지 (`scripts/banners/endfield-official.mjs`, 자료 주소 `web-news.gryphline.com/api/bulletin`) | 제목 `「이름」 특별 허가\|재구축 헤드헌팅`인 공지만 해석. 시간은 Asia 서버(UTC+8). "버전 업데이트 후/전까지"는 근사값으로 채우고 `startApprox`/`endApprox` 표시. 해석 못 한 공지는 실행 로그에 경고로 나온다 |
| 명일방주 | 한국 서버 게임 내 공식 공지 (`scripts/banners/arknights-official.mjs` + `ocr_image.py`) | 공지는 배너 그림 한 장. `pip install rapidocr onnxruntime` 필요(없으면 새 배너를 못 읽고 경고). 제목이 한정/일반 헤드헌팅인 것만, ID는 링크의 풀 ID. 큰 글씨=6성, 작은 글씨=5성. 확신 0.95 미만은 버리고 `needsReview`. 실행 로그에 "사람이 확인해야 하는 배너"가 나오면 공지 그림(`bulletin/<cid>`의 `bannerImageUrl`)을 직접 보고 `data/names/arknights-banners.json`에 기간·이름을 적는다(확실히 읽히는 것만). 공지에는 진행 중인 배너만 있어 이전 팩을 이어받는다 |
| 림버스 | 스팀 공식 공지 한국어판 (`scripts/banners/limbus-official.mjs`) | 공지 제목 `YYYY.MM.DD (KST) … 특정 추출`에서 날짜, 본문의 유튜브 영상 제목(`[000] 이름 / [00] 이름 / [TETH] 이름`)에서 픽업을 읽는다. 본문은 그림뿐이라 영상이 없는 공지(발푸르기스의 밤 등)는 건너뛴다. 정확한 기간은 `YYYY년 M월 D일 정기 업데이트 안내` 공지 그림(보통 2쪽)의 `N. 신규 … 특정 추출 […] (11/26 12:00 ~ 12/10 10:00 (KST))`를 tesseract로 읽는다(숫자만 사용, 시작 날짜가 업데이트 날짜와 다르면 버림). 한 번 읽은 기간은 이전 팩에서 이어받아 다시 읽지 않는다. tesseract가 없으면 근사값(`apt-get install tesseract-ocr tesseract-ocr-kor`). **발푸르기스의 밤**은 영상이 없어 배너·기간만 공지에서 읽는다. 픽업 이름은 공지 그림 오른쪽 위 이름 칸을 직접 보고 `data/names/limbus-walpurgis.json`의 회차에 적는다(자동 글자 인식 tesseract는 꾸민 글씨를 못 읽는 것을 확인함). 실행 로그에 "픽업 이름이 비어 있는 회차"가 나오면 새 회차를 채운다 |

- **외부 JS는 절대 실행하지 않는다.** `export const x = {...}`는 JSON5로, 다른 모듈을 참조하는 표는 정규식(`extractNames`)으로 읽는다. 외부 코드를 실행하는 방식은 보안 정책에서 실제로 거부됐다.
- 출처 하나가 실패해도 나머지는 만들어지고, 실패 내용은 `errors`에 남는다. validate는 원신·엔드필드가 비면 실패시킨다.

## 엔드필드 공지 형식이 바뀌었을 때

실행 로그에 "해석하지 못한 헤드헌팅 공지"가 나오거나 배너가 빠지면:
1. 해당 공지 본문을 받아 본다: `curl "https://web-news.gryphline.com/api/bulletin/<cid>?lang=ko-kr&code=arknights_endfield_official"`
2. `endfield-official.mjs`의 `parseNotice` 규칙을 고치고, 그 공지 문장을 `endfield-official.test.mjs`에 사례로 추가한다
3. 이름은 공식 공지 표기를 그대로 쓴다(임의 번역 금지). 「찬란한 빛의 축제」 특수 헤드헌팅처럼 픽업 6성이 없는 공지는 건너뛰는 것이 정상이다
4. 이 세션에서 실행할 때는 `NODE_USE_ENV_PROXY=1 npm run banners` (Node의 fetch가 프록시를 안 읽기 때문)

## 주간 자동 PR

`.github/workflows/banners.yml`이 매주 수요일 12:17(KST)에 생성 → 변경 시 `bot/banners` 브랜치로 PR. 생성 작업은 읽기 전용 권한, PR 작업만 쓰기 권한이다. PR이 안 생기면 저장소 Settings → Actions → General의 "Allow GitHub Actions to create and approve pull requests"가 꺼져 있는지 사용자에게 확인한다. 검토할 때는 진행 중 배너와 픽업 이름이 실제 게임과 맞는지 본다.

## 새 출처를 붙일 때

`build.mjs`에 게임 함수를 추가하고 같은 형식(`id, group, name, start, end, version, featured[{id,en,cn,ko}], featuredRare`)으로 낸다. 그룹 ID는 `src/lib/games.ts`와 `validate.mjs`의 목록에 있어야 한다. 접속 가능 여부는 먼저 curl로 확인한다(위키류는 Cloudflare로 막힌 곳이 많음 → `twilight-game-reference`).
