// 원신: 게임 내 공식 공지(한국어)에서 진행 중인 기원의 한국어 이름을 읽어 배너에 붙인다.
// 배너 목록·기간·픽업은 기존 자료(paimon.moe)를 쓰고, 여기서는 이름만 한국어로 바꾼다.
// 공식 공지에는 진행 중인 기원만 있으므로, 이미 붙인 한국어 이름은 이전 팩에서 이어받는다.

const ANN = "https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList"
  + "?game=hk4e&game_biz=hk4e_global&lang=ko&bundle_id=hk4e_global&platform=pc&region=os_asia&level=55&uid=100000000";

/** 공지 목록 → [{ name: "「사직 의례」 기원", title, banner }] (기원 공지만). banner = 공지의 한국어 배너 그림 */
export function wishAnnouncements(data) {
  const out = [];
  for (const group of data?.list ?? []) {
    for (const a of group.list ?? []) {
      if (/^「[^」]+」 기원$/.test(a.subtitle ?? "")) {
        out.push({ name: a.subtitle, title: a.title ?? "", ...(/^https:\/\//.test(a.banner ?? "") ? { banner: a.banner } : {}) });
      }
    }
  }
  return out;
}

/**
 * 배너에 한국어 이름을 붙인다(원래 영어 이름은 nameEn에 남긴다).
 * - 진행 중인 배너: 픽업 최고 등급의 한국어 이름이 공지 제목에 들어 있으면 그 공지의 기원 이름
 * - 그 외: 이전 팩에 한국어 이름이 있으면 이어받는다
 * 배너 그림도 같은 공지의 한국어 그림으로 바꾸고(영어판 그림 대신, 사용자 지적 2026-11-27), 지난 배너는 이전 팩에서 이어받는다.
 */
export function applyKoreanNames(banners, announcements, previous = [], now = new Date()) {
  const kept = new Map(previous.filter((b) => b.nameEn).map((b) => [b.id, b.name]));
  const keptImage = new Map(previous.filter((b) => KO_IMAGE.test(b.image ?? "")).map((b) => [b.id, b.image]));
  const t = now.toISOString();
  return banners.map((b) => {
    let ko = null;
    let image = null;
    if (b.start <= t && t <= b.end) {
      const hit = announcements.find((a) =>
        b.group === "genshin-chronicled"
          ? a.title.includes("묶음 기원")
          : b.featured.some((f) => f.ko && a.title.includes(f.ko)));
      ko = hit?.name ?? null;
      image = hit?.banner ?? null;
    }
    ko ??= kept.get(b.id) ?? null;
    image ??= keptImage.get(b.id) ?? null;
    return { ...b, ...(ko ? { name: ko, nameEn: b.name } : {}), ...(image ? { image } : {}) };
  });
}

/** 공식 한국어 공지 그림 주소 (영어판 팬 자료 그림과 구분) */
const KO_IMAGE = /^https:\/\/sdk\.hoyoverse\.com\/upload\/ann\//;

export async function fetchWishAnnouncements() {
  const res = await fetch(ANN, { headers: { "User-Agent": "twilight-games-banner-pack" } });
  if (!res.ok) throw new Error(`${res.status} 원신 공지`);
  const body = await res.json();
  if (body.retcode !== 0) throw new Error(`원신 공지 응답 오류 ${body.retcode}`);
  return wishAnnouncements(body.data);
}

// 기원 상세(게임 안 "상세" 화면과 같은 공식 자료): 지금 열린 기원의 규칙 글과 등급별 목록.
const DETAIL = "https://operation-webstatic.hoyoverse.com/gacha_info/hk4e/os_asia";

/** 기원 상세 한 건 → { up: 픽업 5성 이름들, pool: 픽업이 아닌 5성 이름들 }. 5성 목록이 없으면 null */
export function wishDetail(detail) {
  const list = detail?.r5_prob_list ?? [];
  if (!list.length) return null;
  const up = list.filter((i) => i.is_up).map((i) => i.item_name);
  const pool = list.filter((i) => !i.is_up).map((i) => i.item_name);
  return up.length ? { up, pool } : null;
}

/**
 * 배너에 "픽업이 아닌 5성 목록"(pool)을 붙인다.
 * - 진행 중인 배너: 기원 상세의 픽업 이름이 배너 픽업과 같을 때만 그 상세의 목록
 * - 그 외: 이전 팩의 목록을 이어받는다(상세에는 지금 열린 기원만 있으므로)
 */
export function applyWishPools(banners, details, previous = [], now = new Date()) {
  const kept = new Map(previous.filter((b) => b.pool?.length).map((b) => [b.id, b.pool]));
  const t = now.toISOString();
  return banners.map((b) => {
    let pool = null;
    if (b.start <= t && t <= b.end) {
      const mine = b.featured.map((f) => f.ko).filter(Boolean);
      const hit = details.find((d) => d.up.length === mine.length && d.up.every((n) => mine.includes(n)));
      if (hit?.pool.length) pool = hit.pool.map((ko) => ({ id: `ko:${ko}`, ko }));
    }
    pool ??= kept.get(b.id) ?? null;
    return pool ? { ...b, pool } : b;
  });
}

export async function fetchWishDetails() {
  const get = async (url) => {
    const res = await fetch(url, { headers: { "User-Agent": "twilight-games-banner-pack" } });
    if (!res.ok) throw new Error(`${res.status} 원신 기원 상세`);
    return res.json();
  };
  const list = (await get(`${DETAIL}/gacha/list.json`)).data?.list ?? [];
  const out = [];
  for (const g of list) {
    const d = wishDetail(await get(`${DETAIL}/${g.gacha_id}/ko-kr.json`));
    if (d) out.push(d);
  }
  return out;
}
