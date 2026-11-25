import { describe, expect, it } from "vitest";
import { buildBanners, parseEvent, parseVideoTitle, parseWalpurgis } from "./limbus-official.mjs";

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
});
