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
  // 위쪽 오른편에 재화 숫자가 가로로 놓인다. 맨 오른쪽 둘이 오로베릴, 파생 오리지늄.
  const top = numbersIn(lines, (l) => l.y < 0.1 && l.x > 0.4);
  const currency: Record<string, number> = {};
  if (top.length >= 2) {
    currency.oroberyl = top[top.length - 2].n;
    currency.origeometry = top[top.length - 1].n;
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

function limbus(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /10회추출/) || !has(lines, /1회추출/)) return null;
  // 광기는 아래쪽 "LUNACY" 표시 근처의 숫자.
  const label = lines.find((l) => /LUNACY/i.test(l.t));
  const near = numbersIn(lines, (l) => l.y > 0.8 && (label ? Math.abs(l.x - label.x) < 0.12 && l.y >= label.y : l.x > 0.3 && l.x < 0.5));
  const currency: Record<string, number> = {};
  if (near.length) currency.lunacy = near[near.length - 1].n;
  const until = lines.find((l) => /\d{4}\.\d{2}\.\d{2}.*까지/.test(l.t));
  const kindLine = lines.find((l) => l.x > 0.2 && l.y < 0.2 && /추출/.test(l.t) && !/\d회/.test(l.t));
  const name = kindLine
    ? lines.filter((l) => l !== kindLine && Math.abs(l.x - kindLine.x) < 0.08 && l.y > kindLine.y && l.y < kindLine.y + 0.15 && /[가-힣]/.test(l.t) && !/까지/.test(l.t))
      .sort((a, b) => a.y - b.y)[0]
    : undefined;
  return {
    game: "limbus",
    kind: "gacha-main",
    currency,
    banner: kindLine ? [kindLine.t.trim(), name?.t.trim()].filter(Boolean).join(" ") : null,
    until: until?.t.trim() ?? null,
    toTop: null,
    toFeatured: null,
  };
}

function genshin(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /기원10회/) || !has(lines, /기원1회/)) return null;
  // 오른쪽 위에 원석, 인연 순서로 숫자 두 개.
  const top = numbersIn(lines, (l) => l.y < 0.15 && l.x > 0.55);
  const currency: Record<string, number> = {};
  if (top.length >= 2) {
    currency.primogem = top[top.length - 2].n;
    currency.intertwined = top[top.length - 1].n;
  }
  const until = lines.find((l) => /남은\s*기간|\d+일\s*\d+시간/.test(l.t));
  return { game: "genshin", kind: "gacha-main", currency, banner: null, until: until?.t.trim() ?? null, toTop: null, toFeatured: null };
}

function arknights(lines: ScreenLine[]): ScreenReading | null {
  if (!has(lines, /10회진행/) || !has(lines, /1회진행/)) return null;
  // 재화 위치는 아직 확인하지 못했다(합성옥·오리지늄은 로비 화면 기준). 화면 종류만 알린다.
  return { game: "arknights", kind: "gacha-main", currency: {}, banner: null, until: null, toTop: null, toFeatured: null };
}

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
