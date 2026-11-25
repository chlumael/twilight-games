// 원신: 게임 내 공식 공지(한국어)에서 진행 중인 기원의 한국어 이름을 읽어 배너에 붙인다.
// 배너 목록·기간·픽업은 기존 자료(paimon.moe)를 쓰고, 여기서는 이름만 한국어로 바꾼다.
// 공식 공지에는 진행 중인 기원만 있으므로, 이미 붙인 한국어 이름은 이전 팩에서 이어받는다.

const ANN = "https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList"
  + "?game=hk4e&game_biz=hk4e_global&lang=ko&bundle_id=hk4e_global&platform=pc&region=os_asia&level=55&uid=100000000";

/** 공지 목록 → [{ name: "「사직 의례」 기원", title }] (기원 공지만) */
export function wishAnnouncements(data) {
  const out = [];
  for (const group of data?.list ?? []) {
    for (const a of group.list ?? []) {
      if (/^「[^」]+」 기원$/.test(a.subtitle ?? "")) out.push({ name: a.subtitle, title: a.title ?? "" });
    }
  }
  return out;
}

/**
 * 배너에 한국어 이름을 붙인다(원래 영어 이름은 nameEn에 남긴다).
 * - 진행 중인 배너: 픽업 최고 등급의 한국어 이름이 공지 제목에 들어 있으면 그 공지의 기원 이름
 * - 그 외: 이전 팩에 한국어 이름이 있으면 이어받는다
 */
export function applyKoreanNames(banners, announcements, previous = [], now = new Date()) {
  const kept = new Map(previous.filter((b) => b.nameEn).map((b) => [b.id, b.name]));
  const t = now.toISOString();
  return banners.map((b) => {
    let ko = null;
    if (b.start <= t && t <= b.end) {
      const hit = announcements.find((a) =>
        b.group === "genshin-chronicled"
          ? a.title.includes("묶음 기원")
          : b.featured.some((f) => f.ko && a.title.includes(f.ko)));
      ko = hit?.name ?? null;
    }
    ko ??= kept.get(b.id) ?? null;
    return ko ? { ...b, name: ko, nameEn: b.name } : b;
  });
}

export async function fetchWishAnnouncements() {
  const res = await fetch(ANN, { headers: { "User-Agent": "twilight-games-banner-pack" } });
  if (!res.ok) throw new Error(`${res.status} 원신 공지`);
  const body = await res.json();
  if (body.retcode !== 0) throw new Error(`원신 공지 응답 오류 ${body.retcode}`);
  return wishAnnouncements(body.data);
}
