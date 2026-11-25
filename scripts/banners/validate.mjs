// Sanity checks for a generated banner pack before it can be proposed.
//   node scripts/banners/validate.mjs data/banners.json
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "data/banners.json";
const pack = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const groups = {
  genshin: ["genshin-char", "genshin-weapon", "genshin-chronicled"],
  arknights: ["arknights-limited", "arknights-standard"],
  endfield: ["endfield-chartered", "endfield-refactor"],
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
    if ((b.start === null) !== (b.end === null)) problems.push(`${b.id}: start/end must both be set or both null`);
    if (b.start && Number.isNaN(Date.parse(b.start))) problems.push(`${b.id}: bad start`);
    if (b.start && b.end && b.start > b.end) problems.push(`${b.id}: ends before it starts`);
    if (!Array.isArray(b.featured)) problems.push(`${b.id}: featured must be a list`);
  }
}
// A source that worked last time should not silently vanish.
if (!pack.games?.genshin?.length) problems.push("genshin: no banners (source failed?)");
if (!pack.games?.endfield?.length) problems.push("endfield: no banners (source failed?)");

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${Object.entries(pack.games).map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
