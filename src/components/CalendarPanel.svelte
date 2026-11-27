<script lang="ts">
  import Portrait from "./Portrait.svelte";
  import { bannerImageUrl } from "../lib/images.svelte";
  // 달력 (사용자 요청 2026-11-26). 화면 방식은 사용자가 보여 준 예시처럼: 칸마다 그날 시작하는 일정 이름을 적고,
  // 넘치면 "+N", 날짜를 누르면 아래에 그날 일정 전체(시작하는 것 + 진행 중인 것).
  import { untrack } from "svelte";
  import {
    buildItems, dayOf, dText, edgeOn, monthCells, onDay, periodText, startsOn, validMine, ymd,
    type CalItem, type CalKind, type MyEvent,
  } from "../lib/calendar";
  import type { BannerPack } from "../lib/banners";
  import { GAME_IDS, GAMES } from "../lib/games";
  import { gameIcon } from "../lib/icons";
  import type { GameId } from "../lib/types";

  let { pack, mine = [], game, gameList = GAME_IDS, onMine, onClose }: {
    /** 고를 수 있는 게임 (설정의 "내 게임") */
    gameList?: GameId[];
    pack: BannerPack | null;
    mine?: MyEvent[];
    /** 지금 보고 있는 게임 (게임 고르기의 처음 값) */
    game: GameId;
    onMine: (list: MyEvent[]) => void;
    onClose: () => void;
  } = $props();

  const icon = (g: GameId | null) => (g ? gameIcon(g) : undefined);
  /** 종류 고르기 (픽업·복각은 한 묶음) */
  const KINDS: { k: CalKind; label: string }[] = [
    { k: "pickup", label: "픽업" }, { k: "event", label: "이벤트" }, { k: "version", label: "업데이트" },
    { k: "offline", label: "행사" }, { k: "mine", label: "내 일정" },
  ];

  let games = $state<Set<GameId>>(new Set(untrack(() => gameList))); // 처음에는 내 게임 전부(사용자 2026-11-27: 통합해서 보기)
  let kinds = $state<Set<CalKind>>(new Set(["pickup", "version", "offline", "mine"])); // 이벤트는 많아서 처음에는 끔
  const now = Date.now();
  let month = $state({ y: new Date(now).getFullYear(), m: new Date(now).getMonth() });
  let picked = $state(dayOf(now));
  let showOngoing = $state(false);

  const all = $derived(buildItems(pack, mine));
  const shown = $derived(all.filter((it) => kinds.has(it.kind) && (it.game === null || games.has(it.game))));
  const cells = $derived(monthCells(month.y, month.m).map((c) => ({ ...c, entries: startsOn(shown, c.day) })));
  const starting = $derived(startsOn(shown, picked));
  const ongoing = $derived(onDay(shown, picked, now).filter((it) => !starting.some((e) => e.item.id === it.id)));

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  }
  function move(d: number) {
    const t = new Date(month.y, month.m + d, 1);
    month = { y: t.getFullYear(), m: t.getMonth() };
  }
  function goToday() {
    month = { y: new Date(now).getFullYear(), m: new Date(now).getMonth() };
    picked = dayOf(now);
  }
  const tagClass = (it: CalItem, ending = false) => (ending ? "end" : it.tag === "복각" ? "rerun" : it.kind);

  // 내 일정 넣기
  let adding = $state(false);
  let draft = $state<{ title: string; start: string; end: string; game: GameId | "" }>({ title: "", start: "", end: "", game: "" });
  function openAdd() {
    draft = { title: "", start: ymd(picked), end: "", game: games.size === 1 ? [...games][0] : "" };
    adding = true;
  }
  function saveMine() {
    const ev: Partial<MyEvent> = { id: `${Date.now().toString(36)}`, title: draft.title.trim(), start: draft.start, end: draft.end || null, game: draft.game || null };
    if (!validMine(ev)) return;
    onMine([...mine, ev]);
    adding = false;
    if (draft.game) games = new Set([...games, draft.game]);
    kinds = new Set([...kinds, "mine"]);
  }
  function removeMine(id: string) {
    onMine(mine.filter((m) => `mine:${m.id}` !== id));
  }
  const pickedText = $derived.by(() => {
    const d = new Date(picked);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`;
  });
</script>

<section class="cal">
  <div class="top">
    <strong>달력</strong>

  </div>

  <div class="bar">
    <div class="games">
      {#each gameList as id (id)}
        <button class="g" class:on={games.has(id)} onclick={() => (games = toggle(games, id))}>
          {#if icon(id)}<img src={icon(id)} alt="" />{/if}<span>{GAMES[id].shortName}</span>
        </button>
      {/each}
    </div>
    <div class="kinds">
      {#each KINDS as { k, label } (k)}
        <button class="k {k}" class:on={kinds.has(k)} onclick={() => (kinds = toggle(kinds, k))}>{label}</button>
      {/each}
    </div>
  </div>

  <div class="month">
    <button class="ghost arrow" onclick={() => move(-1)} aria-label="지난달">‹</button>
    <strong>{month.y}년 {month.m + 1}월</strong>
    <button class="ghost arrow" onclick={() => move(1)} aria-label="다음 달">›</button>
    <button class="today-btn" onclick={goToday}>오늘</button>
    <span class="sp"></span>
    <span class="hint">시작일에 표시</span>
  </div>

  <div class="grid">
    {#each ["일", "월", "화", "수", "목", "금", "토"] as w, i (w)}<span class="wd" class:sun={i === 0} class:sat={i === 6}>{w}</span>{/each}
    {#each cells as c (c.day)}
      {@const isToday = c.day === dayOf(now)}
      <button class="cell" class:out={!c.inMonth} class:picked={c.day === picked} onclick={() => { picked = c.day; showOngoing = false; }}>
        <span class="dn" class:sun={new Date(c.day).getDay() === 0}>{new Date(c.day).getDate()}{#if isToday}<em>오늘</em>{/if}</span>
        {#each c.entries.slice(0, 4) as e (e.item.id + e.ending)}
          <span class="ent {tagClass(e.item, e.ending)}">
            {#if e.item.names?.length && e.item.game}<Portrait game={e.item.game} name={e.item.names[0]} size={14} />{:else if icon(e.item.game)}<img src={icon(e.item.game)} alt="" />{/if}
            <span class="nm">{e.item.short}</span>
            <span class="tag {tagClass(e.item, e.ending)}">{e.ending ? "종료" : e.item.tag}</span>
          </span>
        {/each}
        {#if c.entries.length > 4}<span class="more">+{c.entries.length - 4}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="day">
    <div class="dhead">
      <strong>{pickedText}</strong>
      <span class="sp"></span>
      <button class="ghost small" onclick={openAdd}>＋ 내 일정</button>
    </div>

    {#if adding}
      <form class="add" onsubmit={(e) => { e.preventDefault(); saveMine(); }}>
        <input placeholder="일정 이름 (예: 콜라보 카페)" bind:value={draft.title} aria-label="일정 이름" />
        <div class="arow">
          <input type="date" bind:value={draft.start} aria-label="시작일" />
          <span class="muted">~</span>
          <input type="date" bind:value={draft.end} aria-label="끝나는 날 (없으면 하루)" />
        </div>
        <div class="arow">
          <select bind:value={draft.game} aria-label="게임">
            <option value="">게임 없음</option>
            {#each gameList as id (id)}<option value={id}>{GAMES[id].shortName}</option>{/each}
          </select>
          <span class="sp"></span>
          <button type="submit" class="primary" disabled={!draft.title.trim() || !draft.start}>저장</button>
          <button type="button" class="ghost" onclick={() => (adding = false)}>취소</button>
        </div>
      </form>
    {/if}

    {#if !starting.length && !ongoing.length}<p class="muted empty">일정이 없습니다.</p>{/if}
    {#each starting as e (e.item.id + e.ending)}
      {@render row(e.item, e.ending)}
    {/each}
    {#if ongoing.length}
      <button class="ongoing" onclick={() => (showOngoing = !showOngoing)}>
        진행 중 {ongoing.length}개 {showOngoing ? "▲" : "▼"}
      </button>
      {#if showOngoing}
        {#each ongoing as it (it.id)}{@render row(it, false)}{/each}
      {/if}
    {/if}
  </div>
</section>

{#snippet row(it: CalItem, ending: boolean)}
  {@const edge = edgeOn(it, picked)}
  <div class="row">
    {#if icon(it.game)}<img class="ri" src={icon(it.game)} alt="" />{:else}<span class="ri none"></span>{/if}
    <div class="rmain">
      <div class="rtitle">
        <span class="tag {tagClass(it, ending)}">{ending ? "종료" : it.tag}</span>
        {#if it.url}<a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a>{:else}<span>{it.title}</span>{/if}
      </div>
      {#if it.bannerId && it.game && bannerImageUrl(it.game, it.bannerId)}
        <img class="rart" src={bannerImageUrl(it.game, it.bannerId)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
      {/if}
      {#if it.names?.length && it.game}
        <div class="rnames">{#each it.names as n (n)}<Portrait game={it.game} name={n} size={26} />{/each}</div>
      {/if}
      <div class="rmeta">
        <span>{periodText(it)}{it.approx ? " · 일부 추정" : ""}</span>
        {#if edge === "end" && !ending}<span class="endmark">오늘 종료</span>{/if}
        <span class="sp"></span>
        <span>{dText(it, now)}</span>
        {#if it.kind === "mine"}<button class="ghost small" onclick={() => removeMine(it.id)}>지우기</button>{/if}
      </div>
    </div>
  </div>
{/snippet}

<style>
  .rart { width: 100%; max-width: 480px; height: auto; border-radius: var(--radius); margin: 4px 0 2px; display: block; background: var(--panel); }
  .rnames { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; }
  /* 종류별 색: 픽업(보라) · 복각(보라 테두리) · 이벤트(청록) · 업데이트(주황) · 행사(분홍) · 내 일정(연보라) · 종료(회색) */
  .cal {
    --c-pickup: #7c6cf0; --c-event: #26a69a; --c-version: #e0972a; --c-offline: #e0679a; --c-mine: #a98bf5;
    container-type: inline-size;
    display: flex; flex-direction: column; gap: 10px; font-size: 13px;
  }
  .sp { flex: 1; }
  .ghost { background: none; border: 1px solid transparent; padding: 3px 8px; }
  .small { font-size: 12px; }
  .top { display: flex; align-items: center; }
  .top strong { font-size: 16px; }

  .bar { display: flex; flex-direction: column; gap: 6px; }
  .games, .kinds { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .g, .k { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 11px; border-radius: 999px; opacity: 0.5; }
  .g img { width: 16px; height: 16px; object-fit: contain; }
  .g.on, .k.on { opacity: 1; font-weight: 700; }
  .g.on { border-color: var(--top); }
  .k.on { color: #fff; border-color: transparent; }
  .k.pickup.on { background: var(--c-pickup); }
  .k.event.on { background: var(--c-event); }
  .k.version.on { background: var(--c-version); }
  .k.offline.on { background: var(--c-offline); }
  .k.mine.on { background: var(--c-mine); }

  .month { display: flex; align-items: center; gap: 4px; }
  .month strong { font-size: 15px; min-width: 7.5em; text-align: center; }
  .arrow { font-size: 20px; line-height: 1; padding: 0 10px; }
  .today-btn { font-size: 12px; padding: 3px 10px; }
  .hint { font-size: 11px; color: var(--muted); }

  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
  .wd { text-align: center; font-size: 11px; color: var(--muted); padding: 5px 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--panel); }
  .wd.sun, .dn.sun { color: #ff7a7a; }
  .wd.sat { color: #7fb0ff; }
  .cell {
    display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 2px; min-height: 66px; padding: 3px 2px 4px;
    border: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0;
    background: none; text-align: left; overflow: hidden; min-width: 0; color: inherit;
  }
  .cell.out { opacity: 0.35; }
  .cell.picked { outline: 2px solid var(--top); outline-offset: -2px; }
  .dn { font-size: 12px; font-weight: 700; padding: 0 2px; display: flex; align-items: center; gap: 3px; }
  .dn em { font-style: normal; font-size: 9px; font-weight: 700; background: var(--top); color: #1a1408; border-radius: 4px; padding: 0 3px; }
  .ent { display: flex; align-items: center; gap: 2px; min-width: 0; font-size: 10px; line-height: 1.4; border-left: 2px solid var(--c-pickup); padding-left: 2px; }
  .ent img { width: 11px; height: 11px; flex: none; object-fit: contain; }
  .ent .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ent .tag { display: none; }
  .ent.event { border-color: var(--c-event); }
  .ent.version { border-color: var(--c-version); font-weight: 700; }
  .ent.offline { border-color: var(--c-offline); }
  .ent.mine { border-color: var(--c-mine); }
  .ent.rerun { border-left-style: dotted; }
  .ent.end { border-color: var(--muted); color: var(--muted); }
  .more { font-size: 10px; color: var(--muted); padding-left: 3px; }

  /* 넓은 화면(PC 창, 태블릿): 칸을 키우고 이름 옆에 표시를 붙인다 */
  @container (min-width: 560px) {
    .cell { min-height: 96px; padding: 5px 5px 6px; gap: 3px; }
    .dn { font-size: 13px; margin-bottom: 2px; }
    .ent { font-size: 12px; gap: 4px; border-left: 0; padding-left: 0; }
    .ent img { width: 14px; height: 14px; }
    .ent .tag { display: inline-block; }
  }

  .tag { flex: none; font-size: 10px; font-weight: 700; padding: 0 5px; border-radius: 4px; color: #fff; background: var(--c-pickup); line-height: 1.6; }
  .tag.rerun { background: none; color: var(--c-pickup); box-shadow: inset 0 0 0 1px var(--c-pickup); }
  .tag.event { background: var(--c-event); }
  .tag.version { background: var(--c-version); }
  .tag.offline { background: var(--c-offline); }
  .tag.mine { background: var(--c-mine); }
  .tag.end { background: var(--muted); }

  .day { display: flex; flex-direction: column; gap: 4px; }
  .dhead { display: flex; align-items: center; }
  .dhead strong { font-size: 14px; }
  .empty { margin: 2px 0; }
  .row { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .ri { width: 20px; height: 20px; flex: none; object-fit: contain; margin-top: 1px; }
  .ri.none { border-radius: 50%; background: var(--c-mine); width: 10px; height: 10px; margin: 6px 5px; }
  .rmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .rtitle { display: flex; align-items: baseline; gap: 6px; font-size: 14px; font-weight: 600; line-height: 1.35; word-break: keep-all; }
  .rtitle a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
  .rmeta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
  .endmark { color: #ff8a7a; font-weight: 700; }
  .ongoing { align-self: flex-start; font-size: 12px; padding: 4px 10px; margin-top: 4px; }

  .add { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: var(--radius); background: var(--panel); }
  .arow { display: flex; align-items: center; gap: 6px; }
  .arow input { flex: 1; min-width: 0; }
  .primary { font-weight: 700; }
</style>
