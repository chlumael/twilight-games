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

엔드필드는 기간이 없어 위 조건에 모두 걸리므로, `version`이 가장 높은 것만 보면 된다.

## 출처별 주의

| 게임 | 출처 | 주의 |
|---|---|---|
| 원신 | paimon.moe (`banners.js`, `bannersDual.js`, `itemList.js`, `characters.js`, `weaponList.js`, `locales/items/ko.json`) | 시간은 아시아 서버(UTC+8). 캐릭터 배너는 두 5성이 모두 적혀 있어 `shortName`으로 자기 픽업만 남긴다 |
| 엔드필드 | FrostN0v0/EndfieldGachaPoolTable (`master` 브랜치) | 기간 없음, 이름은 중국어 → `data/names/endfield.ko.json`에 한국어를 직접 채운다 |
| 명일방주 | 없음 (한국 서버 데이터 저장소는 2025-12 이후 멈춤) | 화면 인식으로 생성 예정 |
| 림버스 | 없음 (Steam 뉴스 API는 접속되지만 글에서 추출 필요) | 화면 인식으로 생성 예정 |

- **외부 JS는 절대 실행하지 않는다.** `export const x = {...}`는 JSON5로, 다른 모듈을 참조하는 표는 정규식(`extractNames`)으로 읽는다. 외부 코드를 실행하는 방식은 보안 정책에서 실제로 거부됐다.
- 출처 하나가 실패해도 나머지는 만들어지고, 실패 내용은 `errors`에 남는다. validate는 원신·엔드필드가 비면 실패시킨다.

## 엔드필드 한국어 이름 추가

사용자가 알려준 이름만 넣는다(중국어를 임의로 번역해 넣지 않는다).
1. 캐릭터 ID 찾기: `data/banners.json`의 엔드필드 `featured[].id`와 `cn`
2. `data/names/endfield.ko.json`의 `characters`에 `"chr_xxxx": "한국어 이름"`
3. 배너 이름도 알면 `banners`에 `"special_1_6_1": "한국어 배너 이름"`
4. `npm run banners` 후 확인

## 주간 자동 PR

`.github/workflows/banners.yml`이 매주 수요일 12:17(KST)에 생성 → 변경 시 `bot/banners` 브랜치로 PR. 생성 작업은 읽기 전용 권한, PR 작업만 쓰기 권한이다. PR이 안 생기면 저장소 Settings → Actions → General의 "Allow GitHub Actions to create and approve pull requests"가 꺼져 있는지 사용자에게 확인한다. 검토할 때는 진행 중 배너와 픽업 이름이 실제 게임과 맞는지 본다.

## 새 출처를 붙일 때

`build.mjs`에 게임 함수를 추가하고 같은 형식(`id, group, name, start, end, version, featured[{id,en,cn,ko}], featuredRare`)으로 낸다. 그룹 ID는 `src/lib/games.ts`와 `validate.mjs`의 목록에 있어야 한다. 접속 가능 여부는 먼저 curl로 확인한다(위키류는 Cloudflare로 막힌 곳이 많음 → `twilight-game-reference`).
