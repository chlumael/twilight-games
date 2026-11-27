// 기록 계산 (DESIGN.md §6). 네 파일로 나뉘어 있고 여기서 함께 내보낸다 (정리 2026-11-27).
// - ledger-core.ts: 천장·확정 상태, 뽑기 기록, 되돌리기
// - ledger-spend.ts: 재화로 뽑을 수 있는 횟수, 뽑을 때 줄어드는 재화
// - ledger-screen.ts: 화면 인식 값으로 맞추기
// - ledger-edit.ts: 직접 입력·고치기·지우기
export * from "./ledger-core";
export * from "./ledger-spend";
export * from "./ledger-screen";
export * from "./ledger-edit";
