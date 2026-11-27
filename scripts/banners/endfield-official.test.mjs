import { describe, expect, it } from "vitest";
import { parseNotice, plainText, resolveSchedule, sixStarNames } from "./endfield-official.mjs";
import { mergeArsenal, parseArsenal, parseArsenalNotice, parseHeadhuntPools, resolveArsenalEnds } from "./endfield-official.mjs";

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

  it("확률 상세 안내에서 무기 배너: (UP) 무기, 재구축 신청 구분, 날짜가 있으면 기간", () => {
    const text = [
      "무기고 신청", "「유영 신청」이 개방되었습니다.", "유영 신청 확률 상세 안내",
      "개방 시간: 버전 업데이트 후 개방되며, 3회의 「특별 허가 헤드헌팅」 이후 종료", "[6성 무기]", "6성 무기를 획득할 기본 확률: 4.0000%", "6성 무기", "무기 희귀도", "무기", "기본 확률", "6성 무기", "달콤한 거래 (UP)", "1.0000%", "6성 무기", "부요", "0.5000%", "· 확률 증가 무기 최초 획득 후: 0.7256%", "6성 무기", "J.E.T.", "[5성 무기]", "5성 무기", "다른 무기",
      "결빙 신청 확률 상세 안내", "1회 신청할 때마다 획득 가능한 전체 무기 목록 중", "6성 무기", "헤라펜거 (UP)", // 상시 배너(개방 시간 없음) → 빠짐
      "재구축 신청", "「표류 신청」 재구축 신청#1이(가) 개방되었습니다.", "표류 신청 확률 상세 안내",
      "개방 시간: 버전 업데이트 후 ~ 2026/12/16 11:59(서버 시간)", "「표류 신청」 재구축 신청에서 무기 1개를", "사명의 길 (UP)",
    ].join("\n");
    const list = parseArsenal(text);
    expect(list.map((b) => [b.id, b.group, b.featured[0].ko, b.end])).toEqual([
      ["endfield:arsenal:유영 신청", "endfield-arsenal", "달콤한 거래", null],
      ["endfield:arsenal:표류 신청", "endfield-refactor-arsenal", "사명의 길", "2026-12-16T03:59:00.000Z"],
    ]);
    expect(list[0].pool.map((w) => w.ko)).toEqual(["부요", "J.E.T."]);
    const now = "2026-11-26T00:00:00.000Z";
    const first = mergeArsenal(list, [], now);
    expect(first[0]).toMatchObject({ start: now, startApprox: true });
    // 다음 주에 유영 신청이 안 보이면 끝난 것으로
    const later = mergeArsenal([list[1]], first, "2026-12-03T00:00:00.000Z");
    expect(later.find((b) => b.id.endsWith("유영 신청"))).toMatchObject({ start: now, end: "2026-12-03T00:00:00.000Z", endApprox: true });
  });

  it("6성 목록 줄: '획득 가능'과 '획득 가능한' 두 표기 모두, 픽업은 뺀다", () => {
    const mk = (word) => parseNotice(notice("9", "「가」 특별 허가 헤드헌팅", 1, [
      "· 「가」 특별 허가 헤드헌팅에서 확률 증가 6성 오퍼레이터: [결]",
      `· 「가」 특별 허가 헤드헌팅에서 ${word} 6성 오퍼레이터 목록: 결/카뮤/미브/엠버/라스트 라이트`,
    ]));
    for (const word of ["획득 가능", "획득 가능한"]) {
      expect(mk(word).pool.map((p) => p.ko)).toEqual(["카뮤", "미브", "엠버", "라스트 라이트"]);
    }
  });

  it("확률 상세 안내의 캐릭터 6성 표: 재구축 헤드헌팅의 픽업과 나머지", () => {
    const text = [
      "「모루」 헤드헌팅 확률 상세 안내", "개방 시간: …",
      "[6성 오퍼레이터]", "6성 오퍼레이터를 획득할 기본 확률: 0.8000%.", "6성 오퍼레이터", "오퍼레이터 성급", "오퍼레이터", "기본 확률",
      "6성 오퍼레이터", "케르 (UP)", "0.4000%", "6성 오퍼레이터", "명하", "0.0571%", "6성 오퍼레이터", "엠버", "0.0571%",
      "[5성 오퍼레이터]", "5성 오퍼레이터", "체엔", "1.0000%",
      "재구축 헤드헌팅", "「떠도는 모든 소망에게」 재구축 헤드헌팅#1 확률 상세 안내",
      "[6성 오퍼레이터]", "6성 오퍼레이터", "오퍼레이터 성급", "6성 오퍼레이터", "질베르타 (UP)", "0.4000%", "6성 오퍼레이터", "엠버", "0.0800%", "6성 오퍼레이터", "여풍", "0.0800%",
      "[5성 오퍼레이터]",
      "여정의 시작 헤드헌팅 확률 상세 안내", "[6성 오퍼레이터]", "6성 오퍼레이터", "아델리아", "0.1600%", "[5성 오퍼레이터]",
    ].join("\n");
    expect(parseHeadhuntPools(text)).toEqual([
      { name: "「모루」 특별 허가 헤드헌팅", featured: "케르", pool: ["명하", "엠버"] },
      { name: "「떠도는 모든 소망에게」 재구축 헤드헌팅", featured: "질베르타", pool: ["엠버", "여풍"] },
    ]);
  });

  it("무기고 신청 공지: 픽업·6성 목록(무기 종류 괄호 뗌)·시작 시각·종료 규칙", () => {
    const b = parseArsenalNotice(notice("6178", "「월영 신청」 기간 한정 판매 설명", 1793845800, [
      "「월영 신청」 개방 기간 동안 6성 무기 [환월(한손검)]의 획득 확률이 증가합니다!",
      "· 개방 시간: 2026/11/05 12:00(서버 시간) 개방, 「특별 허가 헤드헌팅」 3회 진행 후 종료(「은하수를 부르는 불꽃」부터 집계)",
      "· 「월영 신청」에서 확률 증가 6성 무기: [환월(한손검)]",
      "· 「월영 신청」에서 획득 가능 6성 무기 목록: 환월(한손검)/테르밋 커터(한손검)/백야의 별(한손검)/용사(장병기)",
    ]));
    expect(b).toMatchObject({
      id: "endfield:arsenal:월영 신청", group: "endfield-arsenal", name: "「월영 신청」",
      start: "2026-11-05T04:00:00.000Z", end: null, featured: [{ ko: "환월" }],
      endRule: { count: 3, from: "은하수를 부르는 불꽃" },
    });
    expect(b.pool.map((p) => p.ko)).toEqual(["테르밋 커터", "백야의 별", "용사"]);
    // 날짜 없는 시작("정식 출시 후")은 공지 시각
    const old = parseArsenalNotice(notice("5216", "「용조 신청」 기간 한정 판매 설명", 1768971600, [
      "· 개방 기간: 정식 출시 후 ~ 「특별 허가 헤드헌팅」 3회 진행 후 종료(「불꽃에 그을린 상흔」부터 집계)",
      "· 「용조 신청」에서 확률 증가한 6성 무기: [용조의 불꽃(한손검)]",
    ]));
    expect(old).toMatchObject({ startApprox: true, featured: [{ ko: "용조의 불꽃" }], endRule: { count: 3, from: "불꽃에 그을린 상흔" } });
  });

  it("무기고 신청 종료: 기준 배너부터 세어 3번째 특별 허가가 끝날 때, 아직 공지 전이면 진행 중", () => {
    const ch = (name, start, end) => ({ name: `「${name}」 특별 허가 헤드헌팅`, start, end });
    const chartered = [ch("가", "2026-01-01", "2026-01-20"), ch("나", "2026-01-20", "2026-02-10"), ch("다", "2026-02-10", "2026-03-01"), ch("라", "2026-03-01", "2026-03-20")];
    const w = (from) => ({ id: "w", start: "2026-01-01", end: null, endRule: { count: 3, from } });
    expect(resolveArsenalEnds([w("가")], chartered)[0]).toEqual({ id: "w", start: "2026-01-01", end: "2026-03-01" });
    expect(resolveArsenalEnds([w("다")], chartered)[0].end).toBeNull();
  });

  it("무기고 신청 공지의 다른 표기들: 기간이 다음 줄에 있음, '기준으로 3회의', 특수 헤드헌팅과 함께 종료, 픽업 줄 없음", () => {
    const mk = (cid, title, lines) => parseArsenalNotice(notice(cid, title, 1770000000, lines));
    const a = mk("0754", "「순행 신청」 기간 한정 판매 설명", [
      "「순행 신청」 개방 기간, 6성 무기 [사명의 길(아츠 유닛)]의 획득 확률이 증가합니다!",
      "· 개방 기간:", "Asia 서버 시간: UTC+8",
      "Asia 서버: 2026/02/07 12:00(서버 시간) ~ 「특별 허가 헤드헌팅」 3회 진행 후 종료(「전달자의 바람」부터 집계)",
      "Amercias / Europe 서버: 2026/02/08 12:00(서버 시간) ~ 「특별 허가 헤드헌팅」 3회 진행 후 종료(「전달자의 바람」부터 집계)",
      "· 「순행 신청」에서 확률 증가한 6성 무기: [사명의 길(아츠 유닛)]",
    ]);
    expect(a).toMatchObject({ start: "2026-02-07T04:00:00.000Z", endRule: { count: 3, from: "전달자의 바람" } });
    const b = mk("2652", "「전옥 신청」 기간 한정 판매 설명", [
      "· 개방 시간: 「단청도」 버전 업데이트 후 개방되며, 「만물의 재구성」을 기준으로 3회의 「특별 허가 헤드헌팅」 이후 종료",
      "· 「전옥 신청」에서 확률 증가 6성 무기: [옥에 깃든 형체(양손검)].",
      "· 「전옥 신청」에서 획득 가능 6성 무기 목록: 옥에 깃든 형체(양손검)/과거의 일품(양손검)/위대한 이름(한손검).",
    ]);
    expect(b).toMatchObject({ startApprox: true, featured: [{ ko: "옥에 깃든 형체" }], endRule: { count: 3, from: "만물의 재구성" } });
    expect(b.pool.map((p) => p.ko)).toEqual(["과거의 일품", "위대한 이름"]);
    const c = mk("2669", "「용작 신청」 기간 한정 판매 설명", [
      "· 개방 기간:", "2026/05/14 12:00(서버 시간) 개방, 「찬란한 빛의 축제」 특수 헤드헌팅 진행 후 종료",
      "· 「용작 신청」에서 확률 증가한 6성 무기: [용조의 불꽃(한손검)]",
    ]);
    expect(c).toMatchObject({ start: "2026-05-14T04:00:00.000Z", endRule: { count: 0 } });
    const chartered = [{ name: "「가」 특별 허가 헤드헌팅", start: "2026-04-16", end: "2026-05-22" }, { name: "「나」 특별 허가 헤드헌팅", start: "2026-06-03", end: "2026-06-26" }];
    expect(resolveArsenalEnds([{ ...c, start: "2026-05-14" }], chartered)[0]).toMatchObject({ end: "2026-06-03", endApprox: true });
    const d = mk("2660", "「적옥 신청」 기간 한정 판매 설명", ["「적옥 신청」 개방 기간, 6성 무기 [늑대의 혈흔(한손검)]의 획득 확률이 증가합니다!"]);
    expect(d.featured[0].ko).toBe("늑대의 혈흔");
  });
});

describe("배너 그림 (withCovers)", async () => {
  const { withCovers } = await import("./endfield-official.mjs");
  it("배너 이름의 「…」와 같은 공지 표지를 붙이고, 재구축 신청은 빼 둔다", () => {
    const notices = [
      { title: "「모루, 배낭, 그리고 벌꿀」 특별 허가 헤드헌팅 안내", cover: "https://x/a.png" },
      { title: "「유영 신청」 기간 한정 판매 설명", cover: "https://x/b.png" },
      { title: "「표류 신청」 등 안내", cover: "https://x/c.png" },
    ];
    const out = withCovers([
      { name: "「모루, 배낭, 그리고 벌꿀」 특별 허가 헤드헌팅", group: "endfield-chartered" },
      { name: "「유영 신청」", group: "endfield-arsenal" },
      { name: "「표류 신청」 재구축 신청", group: "endfield-refactor-arsenal" },
    ], notices);
    expect(out.map((b) => b.image)).toEqual(["https://x/a.png", "https://x/b.png", undefined]);
  });
});

describe("시작일을 버전 시작에 맞추기 (alignToVersions)", async () => {
  const { alignToVersions } = await import("./endfield-official.mjs");
  it("\"버전 업데이트 후\"로 공지 시각을 쓴 배너는 가까운 버전 시작으로, 그 시작을 끝으로 쓴 배너도 같이", () => {
    const v = [{ kind: "version", start: "2026-11-25T04:00:00.000Z" }];
    const out = alignToVersions([
      { id: "명하", start: "2026-11-05T04:00:00.000Z", end: "2026-11-24T04:00:00.000Z", endApprox: true },
      { id: "케르", start: "2026-11-24T04:00:00.000Z", end: "2026-12-23T03:59:00.000Z", startApprox: true },
      { id: "표류", start: "2026-11-26T03:47:07.718Z", end: "2026-12-16T03:59:00.000Z", startApprox: true },
      { id: "멀리", start: "2026-12-10T00:00:00.000Z", end: null, startApprox: true },
    ], v);
    expect(out.map((b) => [b.id, b.start.slice(0, 13), b.end?.slice(0, 13) ?? null, !!b.startApprox])).toEqual([
      ["명하", "2026-11-05T04", "2026-11-25T04", false],
      ["케르", "2026-11-25T04", "2026-12-23T03", false],
      ["표류", "2026-11-25T04", "2026-12-16T03", false],
      ["멀리", "2026-12-10T00", null, true],
    ]);
  });
});
