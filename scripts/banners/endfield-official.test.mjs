import { describe, expect, it } from "vitest";
import { parseNotice, plainText, resolveSchedule, sixStarNames } from "./endfield-official.mjs";

const notice = (cid, title, displayTime, lines) => ({
  cid, title, displayTime, data: lines.map((l) => `<p>${l}</p>`).join(""),
});

const chartered = notice("5204", "「모루, 배낭, 그리고 벌꿀」 특별 허가 헤드헌팅", 1795492800, [
  "「모루, 배낭, 그리고 벌꿀」 특별 허가 헤드헌팅 개방 기간에, 6성 오퍼레이터 <b>[케르]</b>의 획득 확률이 증가합니다!",
  "· 개방 시간: 「뜻밖의 만남」 버전 업데이트 후 ~ 2026/12/23 11:59(서버 시간)",
  "※ Asia 서버 시간: UTC+8",
]);
const refactor = notice("3839", "「찬란한 색채」 재구축 헤드헌팅#1 및「점묘 신청」 재구축 신청#1 개방", 1790157600, [
  "「찬란한 색채」 재구축 헤드헌팅#1 개방 기간, 6성 오퍼레이터 [이본]의 획득 확률이 증가합니다!",
  "「점묘 신청」 재구축 신청#1 개방 기간, 6성 무기 [예술의 폭군(권총)]의 획득 확률이 증가합니다!",
  "2026/09/24 12:00(서버 시간) ~ 버전 업데이트 점검 전",
]);

describe("엔드필드 공식 공지 해석", () => {
  it("HTML을 줄 단위 글로 바꾼다", () => {
    expect(plainText("<p>a&nbsp;&amp; b</p><p> c </p>")).toBe("a & b\nc");
  });

  it("특별 허가 헤드헌팅: 이름·픽업 캐릭터·종료일", () => {
    const b = parseNotice(chartered);
    expect(b).toMatchObject({
      id: "endfield:official:5204",
      group: "endfield-chartered",
      name: "「모루, 배낭, 그리고 벌꿀」 특별 허가 헤드헌팅",
      start: null, // "버전 업데이트 후"
      end: "2026-12-23T03:59:00.000Z", // 11:59 UTC+8
      featured: [{ id: "ko:케르", ko: "케르" }],
    });
  });

  it("재구축 헤드헌팅: 무기 픽업은 무시하고 캐릭터만", () => {
    const b = parseNotice(refactor);
    expect(b.group).toBe("endfield-refactor");
    expect(b.featured.map((f) => f.ko)).toEqual(["이본"]);
    expect(b.start).toBe("2026-09-24T04:00:00.000Z");
    expect(b.end).toBeNull();
  });

  it("Asia 서버 기간 줄을 우선한다", () => {
    const b = parseNotice(notice("1", "「가」 특별 허가 헤드헌팅 설명", 1, [
      "「가」 특별 허가 헤드헌팅 기간, 6성 오퍼레이터 [나]의 획득 확률이 증가합니다!",
      "Americas / Europe: 2026/02/08 12:00 ~ 2026/02/25 11:59(서버 시간)",
      "Asia: 2026/02/07 12:00 ~ 2026/02/24 11:59(서버 시간)",
    ]));
    expect(b.start).toBe("2026-02-07T04:00:00.000Z");
  });

  it("헤드헌팅 공지가 아니거나 픽업 캐릭터가 없으면 null", () => {
    expect(parseNotice(notice("2", "버전 업데이트 설명", 1, ["내용"]))).toBeNull();
    expect(parseNotice(notice("3", "「가」 특별 허가 헤드헌팅", 1, ["픽업 설명 없음"]))).toBeNull();
  });

  it("빈 날짜 채우기: 시작은 공지 시각, 종료는 다음 버전 업데이트 무렵", () => {
    const next = { ...parseNotice(chartered) };
    const prev = { ...parseNotice(refactor) };
    const [a, b] = resolveSchedule([next, prev]);
    expect(a.id).toBe("endfield:official:3839");
    expect(a.end).toBe(b.start);
    expect(a.endApprox).toBe(true);
    expect(b.start).toBe(new Date(1795492800 * 1000).toISOString());
    expect(b.startApprox).toBe(true);
    expect(b.endApprox).toBeUndefined();
  });

  it("뒤따르는 배너가 없으면 종료일은 미정", () => {
    const [only] = resolveSchedule([parseNotice(refactor)]);
    expect(only.end).toBeNull();
  });

  it("공지에서 6성 이름 모으기", () => {
    expect(sixStarNames("<p>6성 오퍼레이터 [케르]의 획득 확률이 증가합니다!</p><p>· 획득 가능 6성 오퍼레이터 목록: 케르/명하/라스트 라이트</p>").sort())
      .toEqual(["라스트 라이트", "명하", "케르"]);
  });
});
