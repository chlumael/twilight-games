// 게임 이미지(캐릭터·무기 아이콘, 배너 그림) — 사용자 허용 2026-11-27.
// 이미지는 저장소 main의 data/images/에 있다(scripts/images/build.py가 공개 자료에서 받아 줄인 사본).
// 목록(index.json)만 시작할 때 받아 두고, 그림은 화면에 보일 때 그 주소로 불러온다. 없으면 글자만 보인다.
import type { GameId } from "./types";

// 화면 확인용으로만 VITE_IMAGES_BASE로 바꿀 수 있다(배포 빌드는 기본값)
export const IMAGES_BASE: string = import.meta.env.VITE_IMAGES_BASE || "https://raw.githubusercontent.com/chlumael/twilight-games/main/data/images/";

export interface ImageIndex {
  schemaVersion: 1;
  games: Partial<Record<GameId, { items: Record<string, string>; banners: Record<string, string> }>>;
}

export function isImageIndex(x: unknown): x is ImageIndex {
  return !!x && typeof x === "object" && (x as ImageIndex).schemaVersion === 1 && typeof (x as ImageIndex).games === "object";
}

const state = $state<{ index: ImageIndex | null }>({ index: null });
/** 공백 없앤 이름 → 파일 (게임별, 처음 찾을 때 만든다) */
const loose = new Map<GameId, Map<string, string>>();

export function setImageIndex(index: ImageIndex | null): void {
  state.index = index;
  loose.clear();
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** 캐릭터·무기 이름 → 아이콘 주소 (모르면 null) */
export function iconUrl(game: GameId, name: string | null | undefined): string | null {
  const g = state.index?.games[game];
  if (!g || !name) return null;
  let rel = g.items[name];
  if (!rel) {
    let m = loose.get(game);
    if (!m) loose.set(game, (m = new Map(Object.entries(g.items).map(([k, v]) => [squash(k), v]))));
    rel = m.get(squash(name)) ?? "";
  }
  return rel ? IMAGES_BASE + rel : null;
}

/** 배너 id → 배너 그림 주소 (모르면 null) */
export function bannerImageUrl(game: GameId, bannerId: string | null | undefined): string | null {
  const rel = bannerId ? state.index?.games[game]?.banners[bannerId] : undefined;
  return rel ? IMAGES_BASE + rel : null;
}

/** 이미지 목록에 있는 이름들(캐릭터·인격·무기). 화면 글자를 바로잡는 데도 쓴다(림버스 추출 이력) */
export function itemNames(game: GameId): string[] {
  return Object.keys(state.index?.games[game]?.items ?? {});
}
