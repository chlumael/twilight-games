// Sanity checks for a generated banner pack before it can be proposed.
//   node scripts/banners/validate.mjs data/banners.json
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "data/banners.json";
const pack = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const groups = {
  genshin: ["genshin-char", "genshin-weapon", "genshin-chronicled"],
  arknights: ["arknights-limited", "arknights-collab", "arknights-standard"],
  endfield: ["endfield-chartered", "endfield-refactor", "endfield-arsenal", "endfield-refactor-arsenal"],
  limbus: ["limbus-extraction"],
};

if (pack.schemaVersion !== 1) problems.push("schemaVersion must be 1");
for (const [game, list] of Object.entries(pack.games ?? {})) {
  if (!groups[game]) problems.push(`unknown game ${game}`);
  const ids = new Set();
  for (const b of list) {
    if (ids.has(b.id)) problems.push(`${game}: duplicate id ${b.id}`);
    ids.add(b.id);
    if (!groups[game]?.includes(b.group)) problems.push(`${b.id}: unknown group ${b.group}`);
    if (b.start === null && b.end !== null) problems.push(`${b.id}: end without start`);
    if (b.start && Number.isNaN(Date.parse(b.start))) problems.push(`${b.id}: bad start`);
    if (b.start && b.end && b.start > b.end) problems.push(`${b.id}: ends before it starts`);
    if (!Array.isArray(b.featured)) problems.push(`${b.id}: featured must be a list`);
  }
}
for (const [game, list] of Object.entries(pack.events ?? {})) {
  if (!groups[game]) problems.push(`events: unknown game ${game}`);
  const ids = new Set();
  for (const e of list) {
    if (ids.has(e.id)) problems.push(`events ${game}: duplicate id ${e.id}`);
    ids.add(e.id);
    if (!["event", "version", "offline"].includes(e.kind)) problems.push(`${e.id}: unknown kind ${e.kind}`);
    if (!e.title || !e.start || Number.isNaN(Date.parse(e.start))) problems.push(`${e.id}: title/start missing`);
    if (e.end && e.start > e.end) problems.push(`${e.id}: ends before it starts`);
  }
}
// A source that worked last time should not silently vanish.
if (!pack.games?.genshin?.length) problems.push("genshin: no banners (source failed?)");
if (!pack.games?.endfield?.length) problems.push("endfield: no banners (source failed?)");
if (!pack.games?.limbus?.length) problems.push("limbus: no banners (source failed?)");
if (!pack.games?.arknights?.length) problems.push("arknights: no banners (source failed?)");

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${Object.entries(pack.games).map(([k, v]) => `${k} ${v.length}`).join(", ")}; events: ${Object.entries(pack.events ?? {}).map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
