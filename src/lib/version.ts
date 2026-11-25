// 버전 비교와 PC판 새 버전 확인 (GitHub 릴리스의 최신 버전 번호만 읽는다)

/** "v0.7.2" 같은 글자를 숫자 목록으로. 읽을 수 없으면 null */
export function parseVersion(text: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(text.trim());
  return m ? m[1].split(".").map(Number) : null;
}

/** latest가 current보다 새 버전이면 true */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

const LATEST = "https://api.github.com/repos/chlumael/twilight-games/releases/latest";

/** 최신 릴리스 버전("0.7.3")과 PC 설치 파일이 올라와 있는지. 확인하지 못하면 null */
export async function latestRelease(): Promise<{ version: string; hasPc: boolean } | null> {
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: unknown; assets?: { name?: unknown }[] };
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    if (!parseVersion(tag)) return null;
    const hasPc = Array.isArray(data.assets) && data.assets.some((a) => a?.name === "twilight-games-pc-setup.exe");
    return { version: tag.replace(/^v/, ""), hasPc };
  } catch {
    return null;
  }
}
