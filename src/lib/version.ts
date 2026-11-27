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
export interface LatestRelease {
  version: string;
  hasPc: boolean;
  /** PC 설치 파일을 마지막으로 올린 시각 (푸시할 때마다 같은 버전 릴리스에 덮어써진다) */
  pcUpdatedAt: string | null;
}

/**
 * PC판 업데이트 알림: 새 버전 번호 → "new", 같은 번호라도 설치 파일이 이 프로그램을 만든 뒤 새로 올라왔으면 → "fix".
 * (사용자 2026-11-27: 고칠 때마다 링크로 받아 설치하기 귀찮다. 버전은 사용자가 올리라고 할 때만 올리므로 번호만으로는 모른다)
 * 설치 파일은 화면을 만든 뒤 몇 분 지나서 올라가므로 15분 넘게 차이 날 때만 새것으로 본다.
 */
export function pcUpdateKind(r: LatestRelease | null, current: string | null, builtAt: string): "new" | "fix" | "wait" | "latest" | "fail" {
  if (!r || !current) return "fail";
  if (isNewer(r.version, current)) return r.hasPc ? "new" : "wait";
  if (r.version !== current || !r.hasPc || !r.pcUpdatedAt) return "latest";
  return Date.parse(r.pcUpdatedAt) - Date.parse(builtAt) > 15 * 60_000 ? "fix" : "latest";
}

export async function latestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: unknown; assets?: { name?: unknown; updated_at?: unknown }[] };
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    if (!parseVersion(tag)) return null;
    const pc = Array.isArray(data.assets) ? data.assets.find((a) => a?.name === "twilight-games-pc-setup.exe") : undefined;
    return { version: tag.replace(/^v/, ""), hasPc: !!pc, pcUpdatedAt: typeof pc?.updated_at === "string" ? pc.updated_at : null };
  } catch {
    return null;
  }
}
