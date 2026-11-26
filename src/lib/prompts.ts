// 확인 창: 오버레이 위에 뜨는 작은 질문 줄 (단축키 Ctrl+Alt+Y 예 / Ctrl+Alt+N 아니요).
// 쓰는 곳은 DESIGN.md §4.8 참고 (원신 기원 기록 새로 불러오기).

export type PromptAction = { type: "genshin-reload" };

export interface Prompt {
  id: string;
  text: string;
  yes: string;
  no: string;
  action: PromptAction;
}

const keyOf = (a: PromptAction) => a.type;

/** 같은 질문이 이미 있으면 다시 쌓지 않는다 */
export function pushPrompt(list: Prompt[], p: Prompt): Prompt[] {
  return list.some((x) => keyOf(x.action) === keyOf(p.action)) ? list : [...list, p];
}

export function dropPrompt(list: Prompt[], id: string): Prompt[] {
  return list.filter((p) => p.id !== id);
}
