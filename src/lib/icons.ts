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

/** 게임 앱 아이콘(공식 앱 스토어 아이콘, 사용자 허용 2026-11-27). 게임을 나타내는 자리(게임 줄·달력·통계·친구)에 쓴다 */
export function gameIcon(game: keyof typeof PREFIX): string | undefined {
  return byName[`game_${game}`];
}
