import { describe, expect, it } from "vitest";
import { buildBanners, knownPeriods, parseNewExtractionPeriod, parseUpdateTitle, parseEvent, parseVideoTitle, parseWalpurgis } from "./limbus-official.mjs";

describe("림버스 공식 공지 해석", () => {
  it("추출 공지에서 날짜와 영상을 읽는다", () => {
    expect(parseEvent({
      event_name: " 2026.11.26 (KST) 신규 인격 특정 추출",
      announcement_body: { body: "[previewyoutube=mB3WZv079mA;full][/previewyoutube]" },
    })).toEqual({ date: "2026-11-26", video: "mB3WZv079mA" });
  });

  it("추출 공지가 아니거나 영상이 없으면 null", () => {
    expect(parseEvent({ event_name: "2026년 11월 26일 정기 업데이트 안내", announcement_body: { body: "[previewyoutube=abcdefg;full]" } })).toBeNull();
    expect(parseEvent({ event_name: "2026.03.05 (KST) 제8회 발푸르기스의 밤 특정 추출", announcement_body: { body: "[img]a.png[/img]" } })).toBeNull();
  });

  it("영상 제목에서 픽업을 읽는다", () => {
    expect(parseVideoTitle("LimbusCompany [000] 오트쿠튀르:: 르루주 B2F 타래둥지 그레고르  / [000] 오트쿠튀르:: 르누아르 B3F 건조장 이상")).toEqual([
      { grade: "000", name: "오트쿠튀르::르루주 B2F 타래둥지 그레고르" },
      { grade: "000", name: "오트쿠튀르::르누아르 B3F 건조장 이상" },
    ]);
  });

  it("2성·E.G.O·안내 문구가 섞인 제목", () => {
    expect(parseVideoTitle("LimbusCompany[000] 라만차랜드 이발사 오티스 / [00] 송곳니 사냥 사무소 해결사 홍루")).toEqual([
      { grade: "000", name: "라만차랜드 이발사 오티스" },
      { grade: "00", name: "송곳니 사냥 사무소 해결사 홍루" },
    ]);
    expect(parseVideoTitle("LimbusCompany [TETH] 입주 신고 그레고르 / E.G.O 5단계 환상 해석 개방")).toEqual([{ grade: "TETH", name: "입주 신고 그레고르" }]);
    expect(parseVideoTitle("LimbusCompany [000] 거미집의 검 료슈 (보이스 없음) / E.G.O 5단계 환상 해석 개방")).toEqual([{ grade: "000", name: "거미집의 검 료슈" }]);
    expect(parseVideoTitle("LimbusCompany [HE] - 신규 E.G.O 특정 추출 초롱 싱클레어")).toEqual([{ grade: "HE", name: "초롱 싱클레어" }]);
  });

  it("같은 날짜는 한 배너로 묶고, 종료는 다음 배너 시작(근사값)", () => {
    const list = buildBanners([
      { date: "2026-05-14", items: [{ grade: "000", name: "거미집의 검 료슈" }] },
      { date: "2026-05-14", items: [{ grade: "000", name: "거미집의 검 료슈" }] },
      { date: "2026-05-28", items: [{ grade: "000", name: "가" }, { grade: "00", name: "나" }] },
      { date: "2026-06-01", items: [] },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: "limbus:official:2026-05-14",
      start: "2026-05-13T15:00:00.000Z",
      end: "2026-05-27T15:00:00.000Z",
      startApprox: true,
      endApprox: true,
    });
    expect(list[0].featured).toHaveLength(1);
    expect(list[1].end).toBeNull();
    expect(list[1].featuredRare.map((x) => x.ko)).toEqual(["나"]);
  });

  it("발푸르기스의 밤: 공지의 이벤트 시간을 기간으로 쓴다", () => {
    const w = parseWalpurgis({
      event_name: "2026.11.12 (KST) 제10회 발푸르기스의 밤 신규 인격 & E.G.O 정보 안내",
      rtime32_start_time: 1794452400, rtime32_end_time: 1795654800,
    });
    expect(w).toEqual({ round: 10, date: "2026-11-12", start: "2026-11-12T03:00:00.000Z", end: "2026-11-26T01:00:00.000Z" });
    // 옛 공지는 게시 시각만 있어 기간으로 쓰지 않는다
    expect(parseWalpurgis({
      event_name: "2025.11.06 (KST) 제7회 발푸르기스의 밤 특정 추출", rtime32_start_time: 100, rtime32_end_time: 3700,
    })).toMatchObject({ round: 7, start: null, end: null });
    expect(parseWalpurgis({ event_name: "제10회 발푸르기스의 밤 - PV" })).toBeNull();
  });

  it("발푸르기스 배너가 사이에 끼면 앞 배너는 그 시작에서 끝난다", () => {
    const list = buildBanners(
      [{ date: "2026-10-29", items: [{ grade: "000", name: "가" }] }, { date: "2026-11-26", items: [{ grade: "000", name: "나" }] }],
      [{ round: 10, date: "2026-11-12", start: "2026-11-12T03:00:00.000Z", end: "2026-11-26T01:00:00.000Z" }],
      { 10: [{ grade: "000", name: "쐐기 사무소 대표 오티스" }, { grade: "HE", name: "눈물로 벼려낸 검 홍루" }] },
    );
    expect(list.map((b) => b.id)).toEqual(["limbus:official:2026-10-29", "limbus:official:walpurgis-10", "limbus:official:2026-11-26"]);
    expect(list[0].end).toBe("2026-11-12T03:00:00.000Z");
    expect(list[1]).toMatchObject({ name: "제10회 발푸르기스의 밤 특정 추출", end: "2026-11-26T01:00:00.000Z" });
    expect(list[1].startApprox).toBeUndefined();
    expect(list[1].endApprox).toBeUndefined();
    expect(list[1].featured.map((f) => f.ko)).toEqual(["쐐기 사무소 대표 오티스", "눈물로 벼려낸 검 홍루"]);
  });

  it("정기 업데이트 공지 제목에서 날짜", () => {
    expect(parseUpdateTitle("2026년 10월 1일 정기 업데이트 안내")).toBe("2026-10-01");
    expect(parseUpdateTitle("2026. 11. 12 정기 업데이트 이후 발생한 알려진 이슈 안내")).toBeNull();
  });

  it("글자 인식 결과에서 신규 특정 추출 기간을 읽는다", () => {
    const text = "신규 업데이트 사항\n1. 신규 인격 특정 추출 [오트쿠튀르::르루주 BF 타래둥지 그레고르,\n오트쿠튀르::르누아르 B3F 건조장 이상]\n(11/26 12:00 ~ 12/10 10:00 (KST))\n2. 특정 추출 [로쟈](11/2612:00 ~ 12/11 10:00 (KST))";
    expect(parseNewExtractionPeriod(text, "2026-11-26")).toEqual({ start: "2026-11-26T03:00:00.000Z", end: "2026-12-10T01:00:00.000Z" });
    // 날짜와 시각이 붙어 인식된 경우, 해를 넘기는 경우
    expect(parseNewExtractionPeriod("2. 신규 인격 특정 추출 [가] (10/112:00 ~ 10/15 06:00 (KST))", "2026-10-01"))
      .toEqual({ start: "2026-10-01T03:00:00.000Z", end: "2026-10-14T21:00:00.000Z" });
    expect(parseNewExtractionPeriod("1. 신규 특정 추출 [가] (12/24 12:00 ~ 1/7 10:00 (KST))", "2026-12-24")?.end).toBe("2027-01-07T01:00:00.000Z");
    // 업데이트 날짜와 다르게 읽히면 버린다
    expect(parseNewExtractionPeriod("1. 신규 인격 특정 추출 [가] (11/28 12:00 ~ 12/10 10:00)", "2026-11-26")).toBeNull();
    expect(parseNewExtractionPeriod("2. 특정 추출 [로쟈] (11/26 12:00 ~ 12/10 10:00)", "2026-11-26")).toBeNull();
  });

  it("읽은 기간은 근사값 대신 쓰이고, 다음 실행에 이어받는다", () => {
    const period = { start: "2026-11-26T03:00:00.000Z", end: "2026-12-10T01:00:00.000Z" };
    const [b] = buildBanners([{ date: "2026-11-26", items: [{ grade: "000", name: "가" }] }], [], {}, { "2026-11-26": period });
    expect(b).toMatchObject(period);
    expect(b.startApprox).toBeUndefined();
    expect(b.endApprox).toBeUndefined();
    expect(knownPeriods([b, { id: "limbus:official:2026-10-01", start: "a", end: "b", endApprox: true }])).toEqual({ "2026-11-26": period });
  });
});

describe("배너 그림 (eventImages)", async () => {
  const { eventImages } = await import("./limbus-official.mjs");
  const ev = (name, t, cap, body = "") => ({
    event_name: name, rtime32_start_time: t, clan_steamid: "103582791473108638",
    jsondata: JSON.stringify({ localized_capsule_image: cap ? [cap] : [] }), announcement_body: { body },
  });
  it("소개 영상 그림이 있으면 그것(더 선명), 없으면 표지, 같은 배너는 가장 이른 공지", () => {
    const out = eventImages([
      ev("2026.11.26 (KST) 오트쿠튀르 특정 추출", 20, "bbb.png"),
      ev("2026.11.26 (KST) 오트쿠튀르 특정 추출 안내", 10, "aaa.png"),
      ev("2026.10.29 (KST) 히스클리프 특정 추출", 9, "ddd.png", "[previewyoutube=jWYcZpYtdls;full]"),
      ev("2025.02.20 (KST) 류 이상 특정 추출", 5, "62e63adbc551470064256668df2ba6cae5138cad.png", "[previewyoutube=pEDkIzAgXRk;full]"),
      ev("2026.10.01 (KST) 제10회 발푸르기스의 밤 특정 추출", 7, "ccc.png"),
    ]);
    expect(out["limbus:official:2026-11-26"]).toBe("https://clan.akamai.steamstatic.com/images/43587230/aaa.png");
    expect(out["limbus:official:2025-02-20"]).toBe("https://i.ytimg.com/vi/pEDkIzAgXRk/maxresdefault.jpg");
    expect(out["limbus:official:walpurgis-10"]).toMatch(/ccc\.png$/);
    expect(out["limbus:official:2026-10-29"]).toBe("https://i.ytimg.com/vi/jWYcZpYtdls/maxresdefault.jpg");
  });
});
