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
  const top = numberTokens(lines.filter((l) => l.y < 0.1 && l.x > 0.4));
  const currency: Record<string, number> = {};
  if (top.length >= 2) {
    currency.oroberyl = top[top.length - 1].n;
    const exchange = top[top.length - 2].n;
    if (exchange % ORIGEOMETRY_TO_OROBERYL === 0) currency.origeometry = exchange / ORIGEOMETRY_TO_OROBERYL;
  }
  // 허가증이 정확히 2칸일 때만: 앞 칸 = 특별 허가 헤드헌팅 허가증(한정 헤드헌팅 허가증), 뒤 칸 = 이번 배너 전용
  // 허가증(기간 한정 허가증). 배너 전용을 먼저 쓴다(사용자 확인 2026-11-25).
  if (top.length === 4) {
    currency.charteredPermit = top[0].n;
    currency.limitedPermit = top[1].n;
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
  return { game: "limbus", kind: "gacha-main", currency, banner, until: until?.t.trim() ?? null, toTop: null, toFeatured: null };
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
export function readScreen(frame: ScreenFrame): ScreenReading | null {
  const lines = frame.lines.filter((l) => l.t.trim());
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
  return frame.lines.some((l) => /헤드헌팅|기원|추출|회\s*진행|LUNACY|UID|획득\s*결과/i.test(l.t));
}
