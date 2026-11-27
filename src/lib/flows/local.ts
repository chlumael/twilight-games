// 기기 저장소(localStorage) 읽기·쓰기: 없거나 깨졌으면 기본값, 저장 공간 문제는 무시
export function readLocal<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback; } catch { return fallback; }
}
export function writeLocal(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 공간 문제는 무시 */ }
}
