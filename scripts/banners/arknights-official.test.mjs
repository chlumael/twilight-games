import { describe, expect, it } from "vitest";
import { buildBanner, mergeBanners, noticeGroup, parseNames, parsePeriod, poolId } from "./arknights-official.mjs";

const L = (text, score, h, x = 0) => ({ text, score, h, x, y: 0 });
// 실제 "일반 헤드헌팅" 공지 그림을 읽은 결과
const standard = [
  L("멜라나이트", 1.0, 50, 1377), L("샌드레코너", 1.0, 51, 1189), L("치우바이", 0.98, 78, 242),
  L("윈드차임스", 0.99, 57, 989), L("스테인리스", 1.0, 87, 599), L("바로가기", 1.0, 63, 1361),
  L("이벤트기간:11월20일 04:00~12월 4일 03:59", 0.97, 46, 70),
];
const notice = { title: "일반\\n헤드헌팅", displayTime: "2026-11-20", jumpLink: "uniwebview://move?target=recruit&param1=DOUBLE_KR_42_0_6" };

describe("명일방주 공식 공지 해석", () => {
  it("공지 종류와 풀 ID", () => {
    expect(noticeGroup("일반\\n헤드헌팅")).toBe("arknights-standard");
    expect(noticeGroup("한정\n헤드헌팅")).toBe("arknights-limited");
    expect(noticeGroup("커널\\n헤드헌팅")).toBeNull();
    expect(poolId(notice.jumpLink)).toBe("DOUBLE_KR_42_0_6");
  });

  it("기간: 한국 시간, 해 넘김, 확신 낮은 줄은 무시", () => {
    expect(parsePeriod(standard, "2026-11-20")).toEqual({ start: "2026-11-19T19:00:00.000Z", end: "2026-12-03T18:59:00.000Z" });
    expect(parsePeriod([L("이벤트 기간:12월24일 04:00 ~1월 7일 03:59", 0.95, 40)], "2026-12-24")?.end).toBe("2027-01-06T18:59:00.000Z");
    expect(parsePeriod([L("이벤트 기간:77월20일 04:00~12월 4일 03:59", 0.97, 40)], "2026-11-20")).toBeNull();
    expect(parsePeriod([L("이벤트기간:11월20일 04:00~12월 4일 03:59", 0.63, 40)], "2026-11-20")).toBeNull();
  });

  it("이름: 큰 글씨가 6성, 작은 글씨가 5성", () => {
    const n = parseNames(standard);
    expect(n.featured.map((x) => x.ko)).toEqual(["치우바이", "스테인리스"]);
    expect(n.featuredRare.map((x) => x.ko)).toEqual(["윈드차임스", "샌드레코너", "멜라나이트"]);
    expect(n.unsure).toBe(false);
  });

  it("확신이 낮은 이름은 버리고 확인 필요로 표시", () => {
    const n = parseNames([L("스위디", 0.85, 82), L("팬텀", 1.0, 59)]);
    expect(n.featured.map((x) => x.ko)).toEqual(["팬텀"]);
    expect(n.unsure).toBe(true);
  });

  it("배너 만들기", () => {
    expect(buildBanner(notice, standard)).toMatchObject({
      id: "arknights:official:DOUBLE_KR_42_0_6", group: "arknights-standard", name: "일반 헤드헌팅",
      start: "2026-11-19T19:00:00.000Z", end: "2026-12-03T18:59:00.000Z",
    });
    expect(buildBanner(notice, standard).needsReview).toBeUndefined();
    // 아무것도 못 읽으면: 공지 날짜를 근사 시작으로, 확인 필요
    const blank = buildBanner(notice, []);
    expect(blank).toMatchObject({ start: "2026-11-19T15:00:00.000Z", startApprox: true, end: null, needsReview: true, featured: [] });
    // 사람이 적어 둔 값이 우선
    const fixed = buildBanner(notice, [], { start: "2026-11-16T07:00:00.000Z", end: "2026-11-29T18:59:00.000Z", featured: [{ id: "ko:가", ko: "가" }] });
    expect(fixed.needsReview).toBeUndefined();
    expect(fixed.startApprox).toBeUndefined();
    expect(buildBanner({ ...notice, title: "커널\\n헤드헌팅" }, standard)).toBeNull();
  });

  it("이전 팩과 합치기: 지난 배너 유지, 제대로 읽은 것을 확인 필요로 덮지 않음", () => {
    const old = [{ id: "a", start: "1" }, { id: "b", start: "2" }];
    const merged = mergeBanners(old, [{ id: "b", start: "2", needsReview: true }, { id: "c", start: "3" }]);
    expect(merged.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(merged[1].needsReview).toBeUndefined();
  });
});
