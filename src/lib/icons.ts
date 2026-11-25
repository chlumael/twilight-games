// Currency icons. Game artwork © the respective publishers; used for a
// non-commercial fan tool (see README). Keys: `<game>_<currencyKey>`.
const files = import.meta.glob("../assets/icons/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  byName[path.split("/").pop()!.replace(".png", "")] = url;
}

const PREFIX = { genshin: "gen", arknights: "ak", endfield: "ef", limbus: "lb" } as const;

export function currencyIcon(game: keyof typeof PREFIX, key: string): string | undefined {
  return byName[`${PREFIX[game]}_${key}`];
}
