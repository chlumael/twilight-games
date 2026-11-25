import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { frameText, numberTokens, parseFrameText, parseNumber, readScreen, type ScreenLine } from "./recognize";

/** 사용자 휴대폰에서 "읽은 글자 복사"로 받은 실제 인식 결과 */
const phone = (name: string) => parseFrameText(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8"));

const L = (t: string, x: number, y: number, h = 0.03, w = 0.1): ScreenLine => ({ t, x, y, w, h });
const frame = (lines: ScreenLine[]) => ({ time: 0, landscape: true, lines });

// 사용자가 보낸 엔드필드 헤드헌팅 메인 화면의 글자 배치
const endfield = [
  L("// 헤드헌팅", 0.04, 0.03), L("0", 0.51, 0.03), L("0", 0.59, 0.03), L("0", 0.67, 0.03),
  L("3675", 0.79, 0.03), L("595", 0.89, 0.03),
  L("불꽃에 그을린 상흔", 0.83, 0.13, 0.05), L("지정 오퍼레이터 획득 확률 증가", 0.84, 0.19, 0.02),
  L("잔여 1시간 종료: 02.07 12:00 (UTC+8)", 0.78, 0.23, 0.02),
  L("73 회의 헤드헌팅 내 6성 오퍼레이터", 0.72, 0.26, 0.02), L("3 회의 헤드헌팅 내 5성 혹은 그 이상", 0.72, 0.29, 0.02),
  L("레바테인", 0.67, 0.46), L("50 회의 헤드헌팅 내 확정 획득", 0.71, 0.52, 0.02),
  L("헤드헌팅 상세 정보", 0.13, 0.91, 0.02), L("× 500", 0.76, 0.87, 0.02), L("× 5000", 0.92, 0.87, 0.02),
  L("1회 헤드헌팅", 0.74, 0.92), L("10회 헤드헌팅", 0.9, 0.92),
];
// 사용자가 보낸 림버스 추출 메인 화면
const limbus = [
  L("특정 추출", 0.1, 0.1), L("그레고르", 0.1, 0.17), L("일반 추출", 0.1, 0.35),
  L("특정 추출", 0.33, 0.12, 0.04), L("그레고르", 0.3, 0.2, 0.07), L("2023.03.09 06:00 까지", 0.3, 0.29),
  L("G사 일등대리", 0.74, 0.47), L("그레고르", 0.75, 0.53, 0.05),
  L("확률 상세보기", 0.3, 0.64, 0.02), L("추출 이력", 0.3, 0.71, 0.02),
  L("1회 추출", 0.6, 0.69), L("130", 0.7, 0.72, 0.02), L("10회 추출", 0.76, 0.69), L("1300", 0.86, 0.72, 0.02),
  L("12", 0.29, 0.86, 0.02), L("26", 0.36, 0.86, 0.02), L("15 / 84", 0.29, 0.92, 0.02),
  L("LUNACY", 0.42, 0.86, 0.02), L("3534", 0.43, 0.92, 0.03), L("추출", 0.82, 0.89, 0.02),
];

describe("화면 읽기", () => {
  it("숫자 해석", () => {
    expect(parseNumber("3,675")).toBe(3675);
    expect(parseNumber("× 5000")).toBe(5000);
    expect(parseNumber("15 / 84")).toBeNull();
    expect(parseNumber("레바테인")).toBeNull();
  });

  it("엔드필드 메인: 재화, 배너, 천장·확정까지 남은 횟수", () => {
    expect(readScreen(frame(endfield))).toEqual({
      game: "endfield", kind: "gacha-main",
      currency: { oroberyl: 3675, origeometry: 595 },
      banner: "불꽃에 그을린 상흔",
      until: "02.07 12:00 (UTC+8)",
      toTop: 73, toFeatured: 50,
    });
  });

  it("림버스 메인: 광기, 배너, 종료일", () => {
    expect(readScreen(frame(limbus))).toEqual({
      game: "limbus", kind: "gacha-main",
      currency: { lunacy: 3534 },
      banner: "특정 추출 그레고르",
      until: "2023.03.09 06:00 까지",
      toTop: null, toFeatured: null,
    });
  });

  it("원신 메인: 원석과 인연", () => {
    const r = readScreen(frame([
      L("기원", 0.05, 0.05), L("624", 0.78, 0.05), L("2", 0.87, 0.05), L("덧없는 인생", 0.2, 0.3, 0.06),
      L("남은 기간 17일 3시간", 0.17, 0.55, 0.02), L("뽑기 기록", 0.28, 0.93, 0.02),
      L("기원 1회", 0.63, 0.92), L("기원 10회", 0.82, 0.92),
    ]));
    expect(r).toMatchObject({ game: "genshin", currency: { primogem: 624, intertwined: 2 }, until: "남은 기간 17일 3시간" });
  });

  it("실기: 명일방주 메인 — 합성옥, 교환 칸(×180)으로 오리지늄, 배너·종료일", () => {
    expect(readScreen(phone("arknights-main-phone"))).toMatchObject({
      game: "arknights",
      currency: { orundum: 169680, originite: 179 },
      banner: "비경의 사냥꾼",
      until: "11월 30일 03:59",
      notes: ["화면에 적힌 잔여 110회 헤드헌팅"],
    });
  });

  it("엔드필드: 파생 오리지늄 뒤 '+', 허가증 2칸", () => {
    const r = readScreen(frame([
      L("8", 0.53, 0.04), L("2", 0.61, 0.04), L("10200", 0.73, 0.04), L("52925 (+)", 0.83, 0.04),
      L("잔여 27일 종료: 12. 23 12: 00 (UTC+8)", 0.73, 0.29, 0.02),
      L("73 회의 헤드헌팅 내 6성 오퍼레이터 확정 획득./", 0.71, 0.32, 0.02),
      L("1회 한정 120 회의 헤드헌팅 내 확정 획득", 0.64, 0.52, 0.02),
      L("1회 헤드헌팅", 0.68, 0.9), L("10회 헤드헌팅", 0.84, 0.9),
    ]));
    expect(r).toMatchObject({
      game: "endfield",
      currency: { oroberyl: 10200, origeometry: 52925, charteredPermit: 8, limitedPermit: 2 },
      until: "12. 23 12: 00 (UTC+8)", toTop: 73, toFeatured: 120,
    });
  });

  it("가챠 메인 화면이 아니면 null, 글자가 덜 읽혀도 멈추지 않는다", () => {
    expect(readScreen(frame([L("설정", 0.5, 0.5), L("10회 헤드헌팅", 0.9, 0.92)]))).toBeNull();
    const partial = readScreen(frame(endfield.filter((l) => !/^\d+$/.test(l.t) && !/종료/.test(l.t))));
    expect(partial).toMatchObject({ game: "endfield", currency: {}, until: null, toTop: 73 });
  });

  it("복사용 글은 위에서 아래 순서", () => {
    expect(frameText(frame([L("나", 0.5, 0.5), L("가", 0.1, 0.1)])).split("\n")[0]).toBe("0.10,0.10 0.10x0.03 가");
  });

  it("실기: 원신 메인 — 숫자 4개 중 '+'가 붙은 원석과 맨 오른쪽 인연", () => {
    expect(readScreen(phone("genshin-main-phone"))).toMatchObject({
      game: "genshin", currency: { primogem: 789, intertwined: 171 },
    });
  });

  it("원신: '+'가 안 읽히고 숫자가 셋 이상이면 확신이 없어 비운다", () => {
    const r = readScreen(frame([L("4", 0.61, 0.04), L("850", 0.68, 0.04), L("789", 0.74, 0.04), L("171", 0.86, 0.04), L("기원 1회", 0.62, 0.89), L("기원 10회", 0.81, 0.89)]));
    expect(r?.currency).toEqual({});
  });

  it("숫자 조각: 한 줄에 여러 숫자, 뒤의 '+' 표시", () => {
    expect(numberTokens([L("850 수789 +", 0.68, 0.04, 0.03, 0.13)]).map((t) => [t.n, t.plus])).toEqual([[850, false], [789, true]]);
  });

  it("실기: 림버스 발푸르기스 메인 — 광기, 회차(로마 숫자)로 배너", () => {
    expect(readScreen(phone("limbus-main-phone"))).toMatchObject({
      game: "limbus", currency: { lunacy: 598 }, banner: "제10회 발푸르기스의 밤 특정 추출", until: null,
    });
  });
});
