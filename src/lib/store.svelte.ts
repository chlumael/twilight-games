// 앱 전체가 함께 쓰는 상태 (정리 2026-11-27: App.svelte에 모두 있던 것을 한 곳으로).
// 기록·설정·배너 자료·보고 있는 게임·알림. 다른 파일(flows/*)은 이것을 읽고 고친다.
// 화면 하나에만 쓰는 상태(펼침, 탭 등)는 여기 두지 않는다.
import bundledPack from "../../data/banners.json";
import { GAMES } from "./games";
import { groupBanners, isPack, type BannerPack, type PackBanner } from "./banners";
import { emptyRecords, undo } from "./ledger";
import { stampChanged } from "./merge";
import { defaultSettings, shownGames, type Settings } from "./settings";
import type { GameId, Records } from "./types";

class AppStore {
  // $state.raw: 기록 계산 함수들이 structuredClone을 쓰는데, 깊은 반응형 객체는 복제할 수 없다
  records = $state.raw<Records>(emptyRecords());
  settings = $state.raw<Settings>(defaultSettings());
  pack = $state.raw<BannerPack | null>(isPack(bundledPack) ? (bundledPack as BannerPack) : null);
  /** 지금 보고 있는 게임 */
  game = $state<GameId>("genshin");
  /** 저장해 둔 기록·설정을 다 읽었는지 (그 전에는 저장·동기화하지 않는다) */
  loaded = $state(false);
  toast = $state<string | null>(null);
  /** 방금 한 큰 변경(공식 기록 반영·기록 지우기). "확인할 것"에서 되돌릴 수 있게 보여 준다 */
  lastApply = $state<string | null>(null);
  /** 설정의 "내 게임" */
  myGames = $derived(shownGames(this.settings));

  notify = (msg: string) => {
    this.toast = msg;
    setTimeout(() => (this.toast === msg ? (this.toast = null) : null), 2500);
  };

  /** 기록 바꾸기: 바뀐 게임에 시각·지움 표시를 남긴다(기기끼리 합칠 때 쓰임) */
  update = (next: Records) => {
    this.records = stampChanged(this.records, next);
  };

  undo = () => {
    const r = undo(this.records);
    if (!r.label) return this.notify("되돌릴 기록이 없습니다");
    this.update(r.records);
    this.notify(`되돌림: ${r.label}`);
  };

  setGame = (id: GameId) => {
    this.game = id;
    this.settings = { ...this.settings, lastGame: id };
  };

  /** 설정 바꾸기. 보고 있던 게임을 "내 게임"에서 뺐으면 남은 첫 게임으로 */
  setSettings = (next: Settings) => {
    this.settings = next;
    const list = shownGames(next);
    if (!list.includes(this.game)) this.setGame(list[0]);
  };

  /** 종류의 지금 배너 (배너 자료에서) */
  currentBanner = (game: GameId, groupId: string): PackBanner | undefined =>
    groupBanners(this.pack, game, groupId).find((b) => b.id === this.records.games[game].currentBanner[groupId]);

  /** 종류: 설정에서 고른 것, 없으면 첫 종류 */
  activeGroup = (game: GameId): string => this.settings.activeGroup[game] ?? GAMES[game].groups[0].id;
}


export const app = new AppStore();
