---
name: twilight-gacha-rules
description: 황혼 게임즈의 가챠 규칙을 바꿀 때 사용. 재화·티켓 추가/삭제, 재화 사용 순서(티켓 먼저, 창세의 결정 교환 등), 천장·확률 상승·50:50·픽업 확정·교환(300/200/120/240회) 같은 배너 카운터, 배너 그룹(상시 제외 등) 변경, "가능 횟수 계산이 이상해", "이 재화도 넣어줘", "이 배너는 안 써" 같은 요청이면 반드시 이 스킬을 따라 규칙·테스트·화면·문서를 함께 고친다.
---

# 가챠 규칙 변경

규칙은 코드에 흩어져 있지 않고 **`src/lib/games.ts` 한 곳**에 데이터로 있다. 계산은 `src/lib/ledger.ts`가 이 데이터를 해석한다.

## 데이터 구조 요약 (`games.ts`)

- `currencies[]`: `{ key, label, manualOnly? }`
  - `manualOnly`: 보유량은 직접 입력만, 사용은 자동 차감 (원신 창세의 결정). 화면 인식에서도 늘어나는 값은 읽지 않는다.
- `groups[]`: 천장을 공유하는 단위(배너 종류). 탭 하나 = 그룹 하나.
  - `hardPity`, `softFrom`(확률 상승 시작 회차), `carryOver`(다음 배너로 이월)
  - `featuredRule`: `"fifty-fifty"`(픽뚫 후 확정), `"fate-point"`(무기 포인트), `"none"`
  - `bannerCounters[]`: `{ at, label, untilFeatured?, repeat? }` 배너별 누적 카운터
  - `spend[]`: **차감 순서**. `{ key, cost, pulls, topUp? }`를 앞에서부터 쓴다.
    - 10회권: `{ key: "tenPermit", cost: 1, pulls: 10 }`. 10회 이상 남았을 때만 쓴다.
  - `rotation: { stays }`: 픽업 최고 등급이 "나올 수 있는 목록"에 남는 배너 수(그 배너 포함). 엔드필드 특별 허가 3, 재구축 1 (공식 「오퍼레이터 제외 규칙」). 목록 계산은 `banners.ts`의 `bannerPool`.
  - `lossStreakGuarantee`: 원신 「별빛 포착」(픽뚫 → 확정 픽업이 3번 이어지면 다음은 픽업 확정). `onlyListed`: 배너에 적힌 것만 나오는 종류(원신 묶음 기원).
  - 재화의 `expiresWith`(그 종류의 배너가 끝나면 0) · `bonuses[].nextBanner`(다음 배너가 열릴 때 받는 재화): 배너 자동 전환 때 `carryToNextBanner`가 처리.
  - `freeLabel`: 무료 뽑기(엔드필드 긴급 모집)에서 나온 최고 등급을 천장·횟수에 넣지 않고 기록할 때의 이름 (`recordFreeTop`).
    - 교환: `topUp: { key: "genesis", rate: 1 }`. 모자란 만큼만 다른 재화를 바꿔서 쓴다.

## 사용자와 합의된 규칙 (바꾸기 전에 확인)

- **티켓·허가증이 있는 게임은 모두 티켓을 먼저 쓴다.** (10회권 → 1회권 → 유료 재화)
- 원신: 인연 → 원석 → 창세의 결정(원석으로 교환). 창세의 결정은 수동 입력 전용. 규칙 원문은 공식 기원 상세(`operation-webstatic.hoyoverse.com/gacha_info/hk4e/os_asia/gacha/list.json` → `<gacha_id>/ko-kr.json`)에서 확인한다.
- 원신 상시, 엔드필드 상시(헤드헌팅 허가증 포함)는 추적하지 않는다. **명일방주 일반은 유지**(성능 캐릭터 때문에 사용).
- 엔드필드: 한정 80 천장 이월, 120 픽업 확정(배너마다 1회, 이월 안 됨), 240마다 토큰, 66번째부터 확률 상승. RE-Factor는 따로.
- 림버스: 천장 없음, 특정 추출마다 이상[理想] 200개로 교환(끝나면 끈으로 바뀜). 일반 추출·3성 확정 티켓 추출에는 이상이 없다.
- 명일방주: 일반(표준 헤드헌팅)끼리는 확률 상승 횟수가 이어진다(`carryOver: true`, 2026-11-26 조사). 한정·콜라보는 배너마다 새로. 배너 종류별 보장은 `bannerCounters`의 `bannerMatch`(풀 ID `:SINGLE_`, `:DOUBLE_`)·`next`·`sinceFeatured`로 넣는다. 근거와 확신 정도는 DESIGN.md §6.

## 절차

1. `games.ts`를 고친다. 재화를 지우면 아이콘(`src/assets/icons/`)도 지우고, 그룹을 지우면 `settings.ts`가 없는 그룹을 자동으로 첫 그룹으로 돌리는지 확인한다.
2. **테스트를 먼저 추가한다** (`src/lib/ledger.test.ts`). 최소한 다음을 확인한다.
   - `availablePulls`: 가능 횟수
   - `deduct`: 1회·10회 차감 결과와 순서
   - `spendPreview`: 뽑기 버튼에 표시될 소모 재화
   - 카운터·천장이 바뀌었으면 `groupStatus`
3. `npm test`, `npm run check`
4. 화면 반영 확인 → `twilight-ui-screens` (새 재화는 `sample-data.json`에도 넣는다)
5. 문서: `DESIGN.md` §5(게임별 정의)와 §6(천장 표)의 해당 행을 고치고, 근거 상태(확인됨/추정/확정(사용자))를 적는다.
6. 배너 그룹 ID를 추가·변경했으면 `scripts/banners/validate.mjs`의 그룹 목록과 `build.mjs`의 그룹 매핑도 맞춘다.

## 계산이 이상하다는 제보를 받으면

사용자가 말한 숫자(보유 재화, 기대한 가능 횟수)로 테스트 케이스를 먼저 만들어 재현한 뒤 고친다. 예: 원석 1,000 + 창세 980 → 12회(창세 6회 포함), 10연 = 원석 1,000 + 창세 600.
