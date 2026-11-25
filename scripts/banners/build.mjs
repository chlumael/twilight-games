// Builds data/banners.json: 원신은 공개 정리 자료, 엔드필드는 한국어 공식 공지.
//   node scripts/banners/build.mjs [outFile]
// Upstream files are never executed: JS data modules are parsed as JSON5 text.
import { writeFile } from "node:fs/promises";
import JSON5 from "json5";
import { endfieldOfficial as endfield } from "./endfield-official.mjs";

const PAIMON = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src";

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
        featured: featured.map(name),
        featuredRare: (b.featuredRare ?? []).map(name),
      });
    }
  };
  add(banners.characters, "genshin-char", 1);
  for (const list of Object.values(dual)) add(list, "genshin-char", 2);
  add(banners.weapons, "genshin-weapon", 1);
  add(banners.chronicled, "genshin-chronicled", 1);
  const cutoff = Date.now() - 730 * 864e5; // keep about two years
  return out.filter((b) => Date.parse(b.end) > cutoff).sort((a, b) => a.start.localeCompare(b.start));
}

const games = {};
const errors = {};
for (const [key, fn] of Object.entries({ genshin, endfield })) {
  try {
    games[key] = await fn();
  } catch (e) {
    errors[key] = String(e?.message ?? e);
  }
}
// No automatic source yet; the app creates these from on-screen banner names.
games.arknights = [];
games.limbus = [];

const pack = { schemaVersion: 1, generatedAt: new Date().toISOString(), games, errors };
const outFile = process.argv[2] ?? new URL("../../data/banners.json", import.meta.url);
await writeFile(outFile, JSON.stringify(pack, null, 1) + "\n");
console.log(Object.entries(games).map(([k, v]) => `${k}: ${v.length}`).join(", "), errors);
