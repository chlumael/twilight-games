// 화면 읽기: 기기에서 인식한 글자(위치는 화면 대비 비율)로 "어느 게임의 어떤 화면인지"와
// 화면에 적힌 값(재화, 배너, 남은 횟수)을 판단한다. 순수 함수라 휴대폰 없이 테스트할 수 있다.
// 화면 배치 근거: 사용자가 보낸 메인 화면(엔드필드·림버스)과 영상 자료(원신·명일방주).
import type { GameId } from "./types";

export interface ScreenLine {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenFrame {
  time: number;
  landscape: boolean;
  lines: ScreenLine[];
  /** PC 진단용: 찍은 창 크기, 그림이 한 가지 색으로만 찍혔는지 */
  width?: number;
  height?: number;
  blank?: boolean;
}

export interface ScreenReading {
  game: GameId;
  kind: "gacha-main";
  /** 화면에서 읽은 재화 (키는 games.ts의 재화 키) */
  currency: Record<string, number>;
  /** 배너 이름 (읽혔을 때만) */
  banner: string | null;
  /** 배너 종료 표시 원문 (예: "02.07 12:00 (UTC+8)", "2023.03.09 06:00 까지") */
  until: string | null;
  /** 엔드필드: 화면에 적힌 "N회의 헤드헌팅 내 6성" → 천장까지 남은 횟수 */
  toTop: number | null;
  /** 엔드필드: "N회의 헤드헌팅 내 확정 획득" → 픽업 확정까지 남은 횟수 */
  toFeatured: number | null;
  /** 그 밖에 화면에 적힌 참고 문구 (예: 명일방주 "잔여 110회 헤드헌팅") */
  notes?: string[];
  /** 림버스: 이 배너의 "이상 N/200" (뽑을 때마다 1씩 오른다 — 광기·티켓 어느 쪽으로 뽑아도) */
  counter?: number | null;
  /** 림버스: 오른쪽에 크게 보이는 픽업 인격의 수감자 이름 (배너 확인용) */
  sinner?: string | null;
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** "3,675" "×5000" "3675" → 숫자. 숫자만으로 된 글자가 아니면 null */
export function parseNumber(text: string): number | null {
  const s = text.replace(/[\s,.]/g, "").replace(/^[x×X]/, "");
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

const has = (lines: ScreenLine[], re: RegExp) => lines.some((l) => re.test(squash(l.t)));
const numbersIn = (lines: ScreenLine[], area: (l: ScreenLine) => boolean) =>
  lines
    .filter(area)
    .map((l) => ({ l, n: parseNumber(l.t) }))
    .filter((v): v is { l: ScreenLine; n: number } => v.n !== null)
    .sort((a, b) => a.l.x - b.l.x);

function endfield(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /10회헤드헌팅/) || !has(lines, /1회헤드헌팅/)) return null;
  // 위쪽 오른편 숫자: [허가증들…] [파생 오리지늄 교환 칸] 오로베릴[+].
  // 사용자 확인(2026-11-25): 교환 칸은 보유 파생 오리지늄이 아니라 "전부 오로베릴로 바꾸면 받는 양"(× 75)이다.
  // 맨 오른쪽 숫자 뒤의 "+" 때문에 숫자만으로 된 줄로 읽히지 않으므로 줄 안의 숫자 조각으로 읽는다.
  // PC(윈도우 글자 인식)는 오로베릴 뒤의 세로 구분선·"+" 단추를 "1"로, 교환 칸의 "00"을 "%"로 읽는 일이 있다(실기·사용자 확인 2026-11-25).
  const topLines = lines
    .filter((l) => l.y < 0.1 && l.x > 0.4)
    .map((l) => ({ ...l, t: l.t.replace(/(\d{2,})\s+[1lI|](\s*[+＋⊕\S])?$/, "$1+").replace(/(\d)%/g, (_, d: string) => `${d}00`) }));
  // 숫자 바로 옆(화면 가로의 4.5% 안)에 붙은 한 글자짜리 "1"은 구분선·단추를 잘못 읽은 것이므로 버린다.
  const top = numberTokens(topLines).filter((t, i, all) => !(i > 0 && t.n === 1 && t.x - all[i - 1].x < 0.045 && all[i - 1].n >= 10));
  const currency: Record<string, number> = {};
  // 맨 오른쪽 = 오로베릴, 그 왼쪽 = 교환 칸(반드시 75의 배수). 교환 칸이 75의 배수가 아니면 숫자를 빠뜨렸거나
  // 엉뚱한 것을 읽은 화면이므로 이번 화면의 재화는 통째로 믿지 않는다(교환 칸 10500을 허가증으로 넣던 문제, 2026-11-25).
  const exchange = top.length >= 2 ? top[top.length - 2].n : null;
  if (exchange !== null && exchange % ORIGEOMETRY_TO_OROBERYL === 0) {
    currency.oroberyl = top[top.length - 1].n;
    currency.origeometry = exchange / ORIGEOMETRY_TO_OROBERYL;
    // 허가증이 정확히 2칸일 때만: 앞 칸 = 특별 허가 헤드헌팅 허가증(한정 헤드헌팅 허가증), 뒤 칸 = 이번 배너 전용
    // 허가증(기간 한정 허가증). 배너 전용을 먼저 쓴다(사용자 확인 2026-11-25).
    if (top.length === 4) {
      currency.charteredPermit = top[0].n;
      currency.limitedPermit = top[1].n;
    }
  }
  const before = (re: RegExp) => {
    for (const l of lines) {
      const m = squash(l.t).match(re);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const end = lines.find((l) => /종료/.test(l.t));
  const title = lines
    .filter((l) => l.x > 0.6 && l.y > 0.08 && l.y < 0.25 && /[가-힣]/.test(l.t) && !/종료|잔여|획득|헤드헌팅/.test(l.t))
    .sort((a, b) => b.h - a.h)[0];
  return {
    game: "endfield",
    kind: "gacha-main",
    currency,
    banner: title?.t.trim() ?? null,
    until: end ? end.t.replace(/^.*종료\s*[:：]?\s*/, "").trim() || null : null,
    toTop: before(/(\d+)회의헤드헌팅내6성/),
    toFeatured: before(/(\d+)회의헤드헌팅내확정/),
  };
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
function roman(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]] ?? 0, next = ROMAN[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

function limbus(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /10회추출/) || !has(lines, /1회추출/)) return null;
  // 광기: 아래쪽 "LUNACY" 표시 근처의 숫자. 표시가 잘려 읽히는 일이 많아(실기: "INAY") 위치로도 찾는다.
  const label = lines.find((l) => /UNACY|LUNA|NACY|INAY/i.test(l.t));
  const near = numbersIn(lines, (l) => l.y > 0.8 && (label ? Math.abs(l.x - label.x) < 0.12 && l.y >= label.y : l.x > 0.3 && l.x < 0.5));
  const currency: Record<string, number> = {};
  if (near.length) currency.lunacy = near[near.length - 1].n;
  const until = lines.find((l) => /\d{4}\.\d{2}\.\d{2}.*까지/.test(l.t));
  // 배너: 발푸르기스의 밤은 "WALPURGISNACHT - X"(로마 숫자 = 회차), 그 외는 "특정 추출" 바로 아래의 이름.
  const walp = lines.map((l) => l.t.match(/WALPUR\w*\s*[-–]\s*([IVXL]+)\b/i)).find(Boolean);
  let banner: string | null = null;
  if (walp) {
    banner = `제${roman(walp[1].toUpperCase())}회 발푸르기스의 밤 특정 추출`;
  } else {
    const kindLine = lines.find((l) => l.x > 0.2 && l.y < 0.25 && /^(특정|일반)\s*추출$/.test(l.t.trim()));
    const name = kindLine
      ? lines.filter((l) => l !== kindLine && Math.abs(l.x - kindLine.x) < 0.08 && l.y > kindLine.y && l.y < kindLine.y + 0.15 && /[가-힣]/.test(l.t) && !/까지/.test(l.t))
        .sort((a, b) => a.y - b.y)[0]
      : undefined;
    banner = kindLine ? [kindLine.t.trim(), name?.t.trim()].filter(Boolean).join(" ") : null;
  }
  // 이상 N/200: "이상 [포행] 10/200 교환"처럼 한 줄로 읽힌다(실기 2026-11-27). 이상·교환 글자가 있는 줄의 "N/200"
  const ideal = lines.map((l) => (/이상|교환/.test(l.t) ? l.t.match(/(\d{1,3})\s*\/\s*200\b/) : null)).find(Boolean);
  const counter = ideal && Number(ideal[1]) <= 200 ? Number(ideal[1]) : null;
  // 오른쪽 픽업 인격 칸의 큰 수감자 이름(실기: x 0.75, y 0.51 "그레고르")
  const SINNERS = ["이상", "파우스트", "돈키호테", "료슈", "뫼르소", "홍루", "히스클리프", "이스마엘", "로쟈", "싱클레어", "오티스", "그레고르"];
  const sinner = lines.filter((l) => l.x > 0.6 && l.y > 0.35 && l.y < 0.65).map((l) => squash(l.t)).find((t) => SINNERS.includes(t)) ?? null;
  return { game: "limbus", kind: "gacha-main", currency, banner, until: until?.t.trim() ?? null, toTop: null, toFeatured: null, counter, sinner };
}

/** 한 줄 안의 숫자들을 위치와 함께 꺼낸다. 숫자 바로 뒤에 "+"가 있으면 plus=true (원신 원석의 충전 버튼). */
export function numberTokens(lines: ScreenLine[]): { n: number; x: number; plus: boolean }[] {
  const out: { n: number; x: number; plus: boolean }[] = [];
  for (const l of lines) {
    const text = l.t;
    for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)) {
      const at = m.index ?? 0;
      const after = text.slice(at + m[0].length).trimStart();
      out.push({
        n: Number(m[0].replace(/,/g, "")),
        x: l.x + (l.w * (at + m[0].length / 2)) / Math.max(1, text.length),
        plus: after.startsWith("+"),
      });
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

function genshin(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /기원10회/) || !has(lines, /기원1회/)) return null;
  // 오른쪽 위 숫자들: 스타라이트, 스타더스트, 원석[+], 인연 순서(사용자 확인 2026-11-25). 숫자가 4개까지 나오고
  // 원석 숫자 뒤에 충전 "+"가 붙는다. 원석 = "+"가 붙은 숫자, 인연 = 그보다 오른쪽의 마지막 숫자.
  const tokens = numberTokens(lines.filter((l) => l.y < 0.12 && l.x > 0.5));
  const currency: Record<string, number> = {};
  const p = tokens.findIndex((t) => t.plus);
  if (p >= 0) {
    currency.primogem = tokens[p].n;
    if (p < tokens.length - 1) currency.intertwined = tokens[tokens.length - 1].n;
  } else if (tokens.length === 2) {
    // "+"가 안 읽혔고 숫자가 둘뿐이면 예전 배치(원석, 인연)로 본다. 셋 이상이면 확신이 없어 비운다.
    currency.primogem = tokens[0].n;
    currency.intertwined = tokens[1].n;
  }
  const until = lines.find((l) => /남은\s*기간|\d+일\s*\d+시간/.test(l.t));
  return { game: "genshin", kind: "gacha-main", currency, banner: null, until: until?.t.trim() ?? null, toTop: null, toFeatured: null };
}

function arknights(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /10회진행/) || !has(lines, /1회진행/)) return null;
  // 위쪽 오른편 숫자: 용문폐, 공개모집 허가증(사용자 확인), [오리지늄 → 합성옥 교환 시 받는 양], 합성옥.
  // 실기(2026-11-25): 교환 칸은 보유 오리지늄이 아니라 "전부 바꾸면 받는 합성옥"(179 × 180 = 32220)이 적혀 있다.
  const top = numberTokens(lines.filter((l) => l.y < 0.1 && l.x > 0.5));
  const currency: Record<string, number> = {};
  if (top.length >= 2) {
    currency.orundum = top[top.length - 1].n;
    const exchange = top[top.length - 2].n;
    if (exchange % ORIGINITE_TO_ORUNDUM === 0) currency.originite = exchange / ORIGINITE_TO_ORUNDUM;
  }
  // 배너: "… 에 종료합니다" 바로 위 줄이 배너 이름
  const endLine = lines.find((l) => /종료합니다/.test(l.t));
  const title = endLine
    ? lines.filter((l) => l.y < endLine.y && l.y > endLine.y - 0.08 && Math.abs(l.x - endLine.x) < 0.05 && /[가-힣]/.test(l.t))
      .sort((a, b) => b.y - a.y)[0]
    : undefined;
  const remain = lines.map((l) => squash(l.t).match(/잔여(\d+)회/)).find(Boolean);
  return {
    game: "arknights",
    kind: "gacha-main",
    currency,
    banner: title?.t.trim() ?? null,
    until: endLine ? endLine.t.replace(/\s*에\s*종료합니다.*$/, "").trim() : null,
    toTop: null,
    toFeatured: null,
    notes: remain ? [`화면에 적힌 잔여 ${remain[1]}회 헤드헌팅`] : [],
  };
}

/** 엔드필드 파생 오리지늄 1개 = 오로베릴 75개 (DESIGN.md, Game8 확인) */
const ORIGEOMETRY_TO_OROBERYL = 75;

/** 명일방주 오리지늄 1개 = 합성옥 180개 */
const ORIGINITE_TO_ORUNDUM = 180;

/** 가챠 메인 화면이면 읽은 내용을, 아니면 null을 돌려준다. */
/** 글자 인식이 자주 틀리는 낱말을 바로잡는다 (PC 윈도우 글자 인식: "해드현팅"·"헤드현팅" → "헤드헌팅"). */
export function fixWords(text: string): string {
  return text.replace(/[헤해]\s?드\s?[헌현]\s?팅/g, "헤드헌팅");
}

/** 프레임의 모든 줄에 fixWords를 적용한다. 화면 읽기가 들어오는 입구에서 한 번 부른다. */
export function normalizeFrame(frame: ScreenFrame): ScreenFrame {
  return { ...frame, lines: frame.lines.map((l) => ({ ...l, t: fixWords(l.t) })) };
}

export function readScreen(frame: ScreenFrame): ScreenReading | null {
  const lines = normalizeFrame(frame).lines.filter((l) => l.t.trim());
  return endfield(lines) ?? limbus(lines) ?? genshin(lines) ?? arknights(lines);
}

/** 사람이 복사해서 보낼 수 있는 글: 위치와 함께 읽은 줄을 위에서 아래로. */
export function frameText(frame: ScreenFrame): string {
  return [...frame.lines]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((l) => `${l.x.toFixed(2)},${l.y.toFixed(2)} ${l.w.toFixed(2)}x${l.h.toFixed(2)} ${l.t}`)
    .join("\n");
}

/** frameText로 복사한 글을 다시 화면 데이터로 바꾼다 (사용자가 보낸 실기 결과를 테스트에 쓰기 위해). */
export function parseFrameText(text: string): ScreenFrame {
  const lines: ScreenLine[] = [];
  for (const row of text.split("\n")) {
    const m = row.match(/^\s*([\d.]+),([\d.]+)\s+([\d.]+)x([\d.]+)\s+(.*)$/);
    if (m) lines.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], t: m[5] });
  }
  return { time: 0, landscape: true, lines };
}

/** 게임 가챠 화면으로 보이는지 (규칙에 안 맞아도 "읽은 글자 복사"용으로 남길지 판단) */
export function looksLikeGacha(frame: ScreenFrame): boolean {
  return frame.lines.some((l) => /헤드헌팅|기원|추출|회진행|LUNACY|UID|획득결과/i.test(fixWords(l.t).replace(/\s+/g, "")));
}

/**
 * 화면에 적힌 "천장까지 N회" 같은 숫자는 가끔 한 글자가 빠져 읽힌다("53" → "3").
 * 그래서 새 값은 두 번 연속 같게 읽혔을 때만 받아들이고, 그 전까지는 앞서 보여 주던 값을 유지한다.
 */
export interface SteadyCounts {
  shown: { toTop: number | null; toFeatured: number | null };
  last: { toTop: number | null; toFeatured: number | null };
  /** 이번에 읽은 값이 직전과 같아서 믿을 수 있는지 (앱의 천장 수치에 반영해도 되는지) */
  settled: boolean;
}
export function steadyCounts(prev: SteadyCounts | null, reading: Pick<ScreenReading, "toTop" | "toFeatured">): SteadyCounts {
  const now = { toTop: reading.toTop, toFeatured: reading.toFeatured };
  if (!prev) return { shown: now, last: now, settled: false };
  const pick = (k: "toTop" | "toFeatured") => (now[k] !== null && now[k] === prev.last[k] ? now[k] : prev.shown[k] ?? now[k]);
  const settled = now.toTop !== null && now.toTop === prev.last.toTop && now.toFeatured === prev.last.toFeatured;
  return { shown: { toTop: pick("toTop"), toFeatured: pick("toFeatured") }, last: now, settled };
}
