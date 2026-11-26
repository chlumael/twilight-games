import { describe, expect, it } from "vitest";
import { datesIn, arknightsItems, efPeriod, efSections, genshinItems, limbusItems, mergeEvents, zoned } from "./events.mjs";

describe("달력 일정 수집", () => {
  it("시각: 서버 시간(UTC+8) → ISO", () => {
    expect(zoned("2026-11-19 16:00:00")).toBe("2026-11-19T08:00:00.000Z");
    expect(zoned("2026/12/16 12:00(서버 시간)")).toBe("2026-12-16T04:00:00.000Z");
  });
  it("원신: 이벤트 공지와 버전 기간, 기원·상시 안내는 뺀다", () => {
    const data = { timezone: 8, list: [
      { type_id: 2, list: [{ ann_id: 1, subtitle: "7.2 버전 업데이트 안내", title: "7.2 버전 「종말의 서막」 업데이트 안내", start_time: "2026-11-04 07:00:00", end_time: "2026-12-16 06:00:00" }] },
      { type_id: 1, list: [
        { ann_id: 2, subtitle: "「투지 포착」", title: "이벤트", start_time: "2026-11-25 12:00:00", end_time: "2026-12-07 03:59:59" },
        { ann_id: 3, subtitle: "「사직 의례」 기원", title: "「사직 의례」 기원: 확률 UP!", start_time: "2026-11-19 16:00:00", end_time: "2026-12-15 14:59:59" },
        { ann_id: 4, subtitle: "「사냥 시작!」", title: "초심자", start_time: "2026-08-10 12:00:00", end_time: "2027-07-14 07:00:00" },
      ] },
    ] };
    expect(genshinItems(data).map((e) => [e.kind, e.title])).toEqual([["version", "7.2 버전 「종말의 서막」"], ["event", "「투지 포착」"]]);
  });
  it("명일방주: 게임 데이터의 이벤트, 오래된 것·상시는 뺀다", () => {
    const now = Date.parse("2026-11-26T00:00:00Z");
    const s = (d) => Date.parse(d) / 1000;
    const table = { basicInfo: {
      a: { name: "포영을 뚫는 창뢰", startTime: s("2026-11-16T07:00:00Z"), endTime: s("2026-11-29T18:59:00Z") },
      b: { name: "아주 옛날", startTime: s("2024-01-01T00:00:00Z"), endTime: s("2024-01-10T00:00:00Z") },
    } };
    expect(arknightsItems(table, now).map((e) => e.title)).toEqual(["포영을 뚫는 창뢰"]);
  });
  it("엔드필드: 기간 글 읽기 (날짜 / 버전 업데이트 후 / 버전 업데이트 전 / 버전 기간)", () => {
    const v = { start: "2026-11-25T04:00:00.000Z", end: null };
    expect(efPeriod("「뜻밖의 만남」 버전 업데이트 후 ~ 2026/12/23 11:59(서버 시간)", v)).toEqual({ start: v.start, end: "2026-12-23T03:59:00.000Z" });
    expect(efPeriod("2026/12/16 12:00(서버 시간) ~ 버전 업데이트 점검 전", v)).toEqual({ start: "2026-12-16T04:00:00.000Z", end: null });
    expect(efPeriod("「뜻밖의 만남」 버전 기간", { start: v.start, end: "2027-01-07T04:00:00.000Z" })).toMatchObject({ end: "2027-01-07T04:00:00.000Z", endApprox: true });
  });
  it("엔드필드: 공지 안의 이벤트 구역, 지역별로 반복된 기간은 한 번만, 헤드헌팅 구역은 뺀다", () => {
    const text = [
      "▼//「모루」 특별 허가 헤드헌팅 안내", "· 개방 시간: 2026/11/25 12:00 ~ 2026/12/23 11:59(서버 시간)",
      "5. 「이성 보급」 기간 한정 이벤트", "· 이벤트 시간:",
      "2026/12/09 04:00 ~ 2026/12/16 04:00(서버 시간)", "2026/12/31 04:00 ~ 2027/01/07 04:00(서버 시간)",
      "2026/12/09 04:00 ~ 2026/12/16 04:00(서버 시간)", "2026/12/31 04:00 ~ 2027/01/06 17:00(서버 시간)",
      "· 이벤트 설명: …",
    ].join("\n");
    const out = efSections(text, { start: "2026-11-25T04:00:00.000Z", end: null }, "endfield:1");
    expect(out.map((e) => [e.title, e.start.slice(0, 10)])).toEqual([["「이성 보급」 기간 한정 이벤트", "2026-12-08"], ["「이성 보급」 기간 한정 이벤트", "2026-12-30"]]);
  });
  it("림버스: 기간 있는 공지는 이벤트, 시즌 안내는 버전, 인격 정보·업데이트 안내는 뺀다", () => {
    const t = (d) => Date.parse(d) / 1000;
    const data = { events: [
      { gid: "1", event_type: 35, event_name: "신규 이벤트 - 제10회 발푸르기스의 밤", rtime32_start_time: t("2026-11-12T03:00:00Z"), rtime32_end_time: t("2026-11-26T01:00:00Z") },
      { gid: "2", event_type: 35, event_name: "2026.11.26 (KST) 신규 인격 정보 안내", rtime32_start_time: t("2026-11-26T03:00:00Z"), rtime32_end_time: t("2026-12-10T01:00:00Z") },
      { gid: "3", event_type: 28, event_name: "시즌 8 : 푼크툼에 대한 안내", rtime32_start_time: t("2026-09-17T03:00:00Z"), rtime32_end_time: t("2026-09-17T03:00:00Z") },
      { gid: "4", event_type: 13, event_name: "2026년 11월 26일 정기 업데이트 안내", rtime32_start_time: t("2026-11-26T00:00:00Z"), rtime32_end_time: t("2026-11-26T00:00:00Z") },
    ] };
    expect(limbusItems(data).map((e) => [e.kind, e.title])).toEqual([["event", "제10회 발푸르기스의 밤"], ["version", "시즌 8 푼크툼"]]);
  });
  it("이전 팩의 지난 일정은 남기고, 400일 지난 것은 버린다", () => {
    const now = Date.parse("2026-11-26T00:00:00Z");
    const cur = [{ id: "a", start: "2026-11-20T00:00:00Z", end: null }];
    const prev = [{ id: "a", start: "x" }, { id: "b", start: "2026-06-01T00:00:00Z", end: "2026-06-10T00:00:00Z" }, { id: "c", start: "2024-01-01T00:00:00Z", end: "2024-01-02T00:00:00Z" }];
    expect(mergeEvents(cur, prev, now).map((e) => e.id)).toEqual(["b", "a"]);
  });
  it("외부 행사 날짜: 글 안의 날짜 여러 꼴, 공지 해 기준, 1년 넘게 떨어진 날짜는 버림", () => {
    const posted = "2026-11-20T00:00:00.000Z";
    expect(datesIn("팝업 스토어 2026.12.05 ~ 2026.12.20 진행", posted)).toEqual({ start: "2026-12-05T03:00:00.000Z", end: "2026-12-20T03:00:00.000Z" });
    expect(datesIn("12월 3일부터 12월 7일까지 콜라보 카페", posted)).toMatchObject({ start: "2026-12-03T03:00:00.000Z", end: "2026-12-07T03:00:00.000Z" });
    expect(datesIn("Collaboration starts December 10, 2026", posted)).toEqual({ start: "2026-12-10T03:00:00.000Z", end: null });
    expect(datesIn("2019/01/01 설립", posted)).toBeNull();
    expect(datesIn("날짜 없음", posted)).toBeNull();
  });
});
