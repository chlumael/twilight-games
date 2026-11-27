// Builds data/banners.json: 원신은 공개 정리 자료, 엔드필드는 한국어 공식 공지.
//   node scripts/banners/build.mjs [outFile]
// Upstream files are never executed: JS data modules are parsed as JSON5 text.
import { readFile, writeFile } from "node:fs/promises";
import JSON5 from "json5";
import { arknightsOfficial as arknights, arknightsPoolGroups } from "./arknights-official.mjs";
import { alignToVersions, collectedSixStars, endfieldOfficial, mergeArsenal, skippedNotices } from "./endfield-official.mjs";
import { collectEvents } from "./events.mjs";
import { applyKoreanNames, applyWishPools, fetchWishAnnouncements, fetchWishDetails } from "./genshin-official.mjs";
import { limbusOfficial as limbus } from "./limbus-official.mjs";

const PAIMON = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src";
const PAIMON_STATIC = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/static";

async function get(url, type = "text") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return type === "json" ? res.json() : res.text();
}

/**
 * Parse `export const a = {...}; export const b = {...};` as data.
 * Each exported value must be a plain object/array literal (JSON5), otherwise this throws.
 */
export function parseDataModule(source) {
  const out = {};
  const re = /export\s+const\s+(\w+)\s*=\s*/g;
  const marks = [...source.matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    const literal = source.slice(start, end).trim().replace(/;\s*$/, "");
    out[m[1]] = JSON5.parse(literal);
  });
  return out;
}

/**
 * Pull `id -> name` out of a two-space-indented `key: { ... name: '...' }` table
 * without evaluating it (some tables reference other modules).
 */
export function extractNames(source) {
  const names = {};
  for (const m of source.matchAll(/^ {2}['"]?([\w-]+)['"]?: \{([\s\S]*?)^ {2}\}/gm)) {
    const n = m[2].match(/^ {4}name: (['"])((?:\\.|(?!\1).)*)\1/m);
    if (n) names[m[1]] = n[2].replace(/\\(.)/g, "$1");
  }
  return names;
}

/**
 * `key: { ... name: '...', rarity: N }` 표에서 이름과 등급을 꺼낸다(실행하지 않고 글로 읽는다).
 * 원신 화면 읽기에서 공개 화면의 이름으로 몇 성인지 알아내는 데 쓴다.
 */
export function extractRarities(source) {
  const out = {};
  for (const m of source.matchAll(/^ {2}['"]?([\w-]+)['"]?: \{([\s\S]*?)^ {2}\}/gm)) {
    const n = m[2].match(/^ {4}name: (['"])((?:\\.|(?!\1).)*)\1/m);
    const r = m[2].match(/^ {4}rarity: (\d)/m);
    if (n && r) out[m[1]] = { en: n[2].replace(/\\(.)/g, "$1"), rarity: Number(r[1]) };
  }
  return out;
}

/** 원신 기원에서 나올 수 있는 캐릭터(4·5성)와 무기(3~5성)의 한국어 이름 → 등급 */
async function genshinItems() {
  const [charsSrc, weaponsSrc, ko] = await Promise.all([
    get(`${PAIMON}/data/characters.js`),
    get(`${PAIMON}/data/weaponList.js`),
    get(`${PAIMON}/locales/items/ko.json`, "json"),
  ]);
  const items = {};
  const add = (table, kind, minRarity) => {
    for (const { en, rarity } of Object.values(extractRarities(table))) {
      const name = ko[en];
      if (!name || rarity < minRarity) continue;
      items[name] = { rarity, kind };
    }
  };
  add(weaponsSrc, "weapon", 3);
  add(charsSrc, "character", 4); // 같은 이름이면 캐릭터가 이긴다
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), items };
}

/** paimon.moe times are Asia server time (UTC+8). */
function asiaTime(s) {
  return new Date(s.replace(" ", "T") + "+08:00").toISOString();
}

async function genshin() {
  const [bannersSrc, dualSrc, itemsSrc, charsSrc, weaponsSrc, ko] = await Promise.all([
    get(`${PAIMON}/data/banners.js`),
    get(`${PAIMON}/data/bannersDual.js`),
    get(`${PAIMON}/data/itemList.js`),
    get(`${PAIMON}/data/characters.js`),
    get(`${PAIMON}/data/weaponList.js`),
    get(`${PAIMON}/locales/items/ko.json`, "json"),
  ]);
  const { banners } = parseDataModule(bannersSrc);
  const dual = Object.values(parseDataModule(dualSrc))[0] ?? {};
  const names = {};
  for (const src of [itemsSrc, charsSrc, weaponsSrc]) Object.assign(names, extractNames(src));
  const name = (id) => {
    const en = names[id] ?? id;
    return { id, en, ko: ko[en] ?? null };
  };
  const out = [];
  const seen = new Set();
  const add = (list, group, slot) => {
    for (const b of list ?? []) {
      const key = `${group}|${b.start}|${b.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Character banners list both featured 5★s; keep the one this banner is named after.
      let featured = b.featured ?? [];
      if (group === "genshin-char" && b.shortName) {
        const own = featured.filter((id) => (names[id] ?? id).toLowerCase() === b.shortName.toLowerCase());
        if (own.length) featured = own;
      }
      out.push({
        id: `genshin:${group}:${b.start}:${slot}`,
        group,
        name: b.name,
        start: asiaTime(b.start),
        end: asiaTime(b.end),
        version: b.version ?? null,
        source: "paimon.moe (팬 정리 자료)",
        featured: featured.map(name),
        featuredRare: (b.featuredRare ?? []).map(name),
        // 배너 그림 원본(paimon.moe 저장소). 앱은 이것을 줄인 사본(data/images)을 쓴다 — scripts/images
        ...(b.image ? { image: `${PAIMON_STATIC}/images/banners/${encodeURIComponent(`${b.name} ${b.image}`)}.png` } : {}),
      });
    }
  };
  add(banners.characters, "genshin-char", 1);
  for (const list of Object.values(dual)) add(list, "genshin-char", 2);
  add(banners.weapons, "genshin-weapon", 1);
  add(banners.chronicled, "genshin-chronicled", 1);
  const cutoff = Date.now() - 730 * 864e5; // keep about two years
  const list = out.filter((b) => Date.parse(b.end) > cutoff).sort((a, b) => a.start.localeCompare(b.start));
  // 한국어 기원 이름: 공식 게임 내 공지(진행 중인 것) + 이전 팩에서 이어받기. 실패해도 영어 이름으로 계속한다.
  const previous = await readFile(new URL("../../data/banners.json", import.meta.url), "utf8")
    .then((t) => JSON.parse(t).games?.genshin ?? []).catch(() => []);
  const announcements = await fetchWishAnnouncements().catch((e) => {
    console.warn(`원신: 한국어 기원 이름을 읽지 못함 (${e.message})`);
    return [];
  });
  // 픽업이 아닌 5성 목록(픽뚫 후보): 공식 기원 상세(지금 열린 기원) + 이전 팩에서 이어받기
  const details = await fetchWishDetails().catch((e) => {
    console.warn(`원신: 기원 상세를 읽지 못함 (${e.message})`);
    return [];
  });
  return applyWishPools(applyKoreanNames(list, announcements, previous), details, previous);
}

/** 엔드필드: 헤드헌팅 배너는 공지에서 매번 다시 만들고, 무기 배너는 이전 팩과 합친다 */
async function endfield() {
  const list = await endfieldOfficial();
  const previous = await readFile(new URL("../../data/banners.json", import.meta.url), "utf8")
    .then((t) => JSON.parse(t).games?.endfield ?? []).catch(() => []);
  const isArsenal = (b) => b.group === "endfield-arsenal" || b.group === "endfield-refactor-arsenal";
  const arsenal = mergeArsenal(list.filter(isArsenal), previous.filter(isArsenal), new Date().toISOString());
  return [...list.filter((b) => !isArsenal(b)), ...arsenal];
}

const games = {};
const errors = {};
for (const [key, fn] of Object.entries({ genshin, endfield, limbus, arknights })) {
  try {
    games[key] = await fn();
  } catch (e) {
    errors[key] = String(e?.message ?? e);
  }
}
games.arknights ??= [];
games.limbus ??= [];
games.genshin ??= [];
games.endfield ??= [];

if (collectedSixStars.size >= 5) {
  // 엔드필드 6성 이름 (공식 기록 화면 읽기에서 6성 판별용). 예전에 모은 이름도 지우지 않고 합친다.
  const file = new URL("../../data/names/endfield-6star.json", import.meta.url);
  const old = await readFile(file, "utf8").then((t) => JSON.parse(t).names ?? []).catch(() => []);
  const names = [...new Set([...old, ...collectedSixStars])].sort();
  await writeFile(file, JSON.stringify({ _comment: "엔드필드 6성 오퍼레이터 한국어 이름. 공식 공지에서 모은다(build.mjs).", names }, null, 1) + "\n");
}

// 명일방주 6성 한국어 이름 (요스타 가챠 기록 화면 읽기에서 6성 판별용):
// 한국 서버 게임 데이터(Kengxxiao/ArknightsGameData_YoStar, 데이터로만 읽음) + 배너 자료의 6성 픽업
try {
  const table = await get("https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_YoStar/main/ko_KR/gamedata/excel/character_table.json", "json");
  const names = new Set(
    Object.entries(table)
      .filter(([id, c]) => id.startsWith("char_") && (c.rarity === "TIER_6" || c.rarity === 5))
      .map(([, c]) => c.name),
  );
  for (const b of games.arknights ?? []) for (const f of b.featured ?? []) if (f.ko) names.add(f.ko);
  const file = new URL("../../data/names/arknights-6star.json", import.meta.url);
  const old = await readFile(file, "utf8").then((t) => JSON.parse(t).names ?? []).catch(() => []);
  if (names.size > 50) {
    const all = [...new Set([...old, ...names])].sort();
    await writeFile(file, JSON.stringify({ _comment: "명일방주 6성 오퍼레이터 한국어 이름. 한국 서버 게임 데이터 + 배너 픽업(build.mjs).", names: all }, null, 1) + "\n");
  }
} catch (e) {
  console.warn(`명일방주 6성 이름 표를 만들지 못함 (${e.message})`);
}

// 명일방주 배너 이름 → 앱의 종류 (요스타 가챠 기록 화면의 배너 이름으로 한정·콜라보·일반을 자동으로 고르기 위해)
// 한국 서버 게임 데이터(ArknightsAssets/ArknightsGamedata kr, 데이터로만 읽음)의 풀 이름과 종류. 이름이 같은데 종류가 다르면(커널 등) null
try {
  const table = await get("https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel/gacha_table.json", "json");
  const pools = arknightsPoolGroups(table.gachaPoolClient ?? []);
  if (Object.keys(pools).length > 50) {
    const file = new URL("../../data/names/arknights-pools.json", import.meta.url);
    await writeFile(file, JSON.stringify({ _comment: "명일방주 배너(풀) 이름 → 종류. null = 같은 이름이 여러 종류라 직접 골라야 함(build.mjs)", pools }, null, 1) + "\n");
  }
} catch (e) {
  console.warn(`명일방주 배너 이름 표를 만들지 못함 (${e.message})`);
}

try {
  const table = await genshinItems();
  if (Object.keys(table.items).length > 100) {
    await writeFile(new URL("../../data/genshin-items.json", import.meta.url), JSON.stringify(table) + "\n");
  }
} catch (e) {
  console.warn(`원신 이름·등급 표를 만들지 못함 (${e.message})`);
}

// 해석하지 못한 공지(형식이 바뀌었을 수 있음) — 주간 PR에서 눈에 띄게 팩에 남긴다
const warnings = skippedNotices.length ? { endfield: [...skippedNotices] } : {};
// 달력 일정(게임 안 이벤트·버전·외부 소식). 배너 자료와 같은 파일에 넣어 앱 업데이트 없이 반영되게 한다
const previousEvents = await readFile(new URL("../../data/banners.json", import.meta.url), "utf8")
  .then((t) => JSON.parse(t).events ?? {}).catch(() => ({}));
const { events, errors: eventErrors } = await collectEvents(previousEvents);
for (const [g, e] of Object.entries(eventErrors)) errors[`events:${g}`] = e;
// 엔드필드: "버전 업데이트 후"라 공지 게시 시각으로 둔 시작일을 버전 시작으로 맞춘다
games.endfield = alignToVersions(games.endfield, events.endfield ?? []);
const pack = { schemaVersion: 1, generatedAt: new Date().toISOString(), games, events, errors, ...(Object.keys(warnings).length ? { warnings } : {}) };
const outFile = process.argv[2] ?? new URL("../../data/banners.json", import.meta.url);
await writeFile(outFile, JSON.stringify(pack, null, 1) + "\n");
console.log(Object.entries(games).map(([k, v]) => `${k}: ${v.length}`).join(", "), errors, warnings);
