// Tracker account: Google sign-in + per-game documents in Firestore.
//   users/{uid}/games/{gameId}  = { data: JSON(GameRecord), updatedAt }
//   users/{uid}/meta/settings   = { data: JSON(Settings), updatedAt }
// 친구 공유(DESIGN.md §8.5, 공유를 켠 사람만):
//   groups/{code}               = { name, owner, members: { uid: true }, createdAt }   code = 초대 코드
//   groups/{code}/members/{uid} = { data: JSON(ShareSummary), updatedAt }             그룹 멤버만 읽기, 본인만 쓰기
// Local storage stays the source of truth while offline; see merge.ts for how copies combine.
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  deleteUser, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut,
  type Auth, type User,
} from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, setDoc, updateDoc, deleteField, type Firestore } from "firebase/firestore/lite";
import type { ShareSummary } from "./share";
import { android, googleLoginPc, inTauri } from "./api";
import { firebaseConfig, googleWebClientId } from "./firebase-config";
import { GAME_IDS } from "./games";
import type { GameId, GameRecord } from "./types";

export interface Account {
  uid: string;
  email: string | null;
  name: string | null;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export const syncConfigured = firebaseConfig !== null;

function ensure(): { auth: Auth; db: Firestore } {
  if (!firebaseConfig) throw new Error("Firebase 설정이 아직 없습니다");
  app ??= initializeApp(firebaseConfig);
  auth ??= getAuth(app);
  db ??= getFirestore(app);
  return { auth, db };
}

function toAccount(u: User | null): Account | null {
  return u ? { uid: u.uid, email: u.email, name: u.displayName } : null;
}

export function watchAccount(cb: (a: Account | null) => void): () => void {
  if (!syncConfigured) return () => {};
  return onAuthStateChanged(ensure().auth, (u) => cb(toAccount(u)));
}

/**
 * Android: Google blocks sign-in inside WebViews, so the app shows the native
 * account picker and hands back an ID token (window.__twilightAuth).
 * Browser / PWA: Firebase popup.
 */
export async function signIn(): Promise<Account | null> {
  const { auth } = ensure();
  const nativeSignIn = android?.signIn?.bind(android);
  if (nativeSignIn) {
    const clientId = googleWebClientId;
    if (!clientId) throw new Error("웹 클라이언트 ID가 설정되지 않았습니다");
    const token = await new Promise<string>((resolve, reject) => {
      (window as unknown as { __twilightAuth?: (t: string | null, e?: string) => void }).__twilightAuth = (t, e) =>
        t ? resolve(t) : reject(new Error(e || "로그인이 취소되었습니다"));
      nativeSignIn(clientId);
    });
    const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(token));
    return toAccount(cred.user);
  }
  if (inTauri) {
    // PC판: 기본 브라우저에서 로그인하고 토큰만 돌려받는다 (프로그램 안 웹 화면에서는 구글 로그인이 막힌다)
    const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(await googleLoginPc()));
    return toAccount(cred.user);
  }
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return toAccount(cred.user);
}

export async function signOutAccount(): Promise<void> {
  await signOut(ensure().auth);
  android?.signOut?.();
}

/** Everything stored for this account (missing games are simply absent). */
export async function pullAll(uid: string): Promise<{ games: Partial<Record<GameId, GameRecord>>; settings: unknown | null }> {
  const { db } = ensure();
  const games: Partial<Record<GameId, GameRecord>> = {};
  const snap = await getDocs(collection(db, "users", uid, "games"));
  snap.forEach((d) => {
    const id = d.id as GameId;
    if (!GAME_IDS.includes(id)) return;
    try {
      games[id] = JSON.parse(d.data().data as string) as GameRecord;
    } catch {
      /* ignore a damaged document rather than overwrite local data with it */
    }
  });
  const s = await getDoc(doc(db, "users", uid, "meta", "settings"));
  let settings: unknown | null = null;
  if (s.exists()) {
    try {
      settings = JSON.parse(s.data().data as string);
    } catch {
      settings = null;
    }
  }
  return { games, settings };
}

export async function pushGame(uid: string, id: GameId, g: GameRecord): Promise<void> {
  const { db } = ensure();
  await setDoc(doc(db, "users", uid, "games", id), { data: JSON.stringify(g), updatedAt: g.updatedAt ?? null });
}

export async function pushSettings(uid: string, settings: unknown): Promise<void> {
  const { db } = ensure();
  await setDoc(doc(db, "users", uid, "meta", "settings"), { data: JSON.stringify(settings), updatedAt: new Date().toISOString() });
}

// ───────────── 친구 공유 ─────────────

export interface ShareGroup {
  code: string;
  name: string;
  owner: string;
  members: string[];
}

/** 그룹 만들기 (만든 사람이 첫 멤버) */
export async function createGroup(uid: string, code: string, name: string): Promise<ShareGroup> {
  const { db } = ensure();
  const g = { name: name.trim().slice(0, 30) || "친구들", owner: uid, members: { [uid]: true }, createdAt: new Date().toISOString() };
  await setDoc(doc(db, "groups", code), g);
  return { code, name: g.name, owner: uid, members: [uid] };
}

export async function getGroup(code: string): Promise<ShareGroup | null> {
  const { db } = ensure();
  const s = await getDoc(doc(db, "groups", code));
  if (!s.exists()) return null;
  const d = s.data();
  return { code, name: String(d.name ?? ""), owner: String(d.owner ?? ""), members: Object.keys(d.members ?? {}) };
}

/** 초대 코드로 참가 (자기 이름만 멤버에 넣을 수 있다 — 보안 규칙) */
export async function joinGroup(uid: string, code: string): Promise<ShareGroup | null> {
  const { db } = ensure();
  const g = await getGroup(code);
  if (!g) return null;
  if (!g.members.includes(uid)) await updateDoc(doc(db, "groups", code), { [`members.${uid}`]: true });
  return { ...g, members: [...new Set([...g.members, uid])] };
}

/** 그룹 나가기: 내 요약을 지우고 멤버에서 뺀다. 만든 사람이 나가면 그룹째 지운다 */
export async function leaveGroup(uid: string, code: string): Promise<void> {
  const { db } = ensure();
  const g = await getGroup(code);
  await deleteDoc(doc(db, "groups", code, "members", uid)).catch(() => {});
  if (!g) return;
  if (g.owner === uid) {
    for (const m of g.members) await deleteDoc(doc(db, "groups", code, "members", m)).catch(() => {});
    await deleteDoc(doc(db, "groups", code));
  } else if (g.members.includes(uid)) {
    await updateDoc(doc(db, "groups", code), { [`members.${uid}`]: deleteField() });
  }
}

/** 내 요약 올리기 (공유를 켠 그룹마다) */
export async function pushShare(uid: string, codes: string[], summary: ShareSummary): Promise<void> {
  const { db } = ensure();
  for (const code of codes) {
    await setDoc(doc(db, "groups", code, "members", uid), { data: JSON.stringify(summary), updatedAt: summary.updatedAt });
  }
}

/** 공유 끄기: 모든 그룹에서 내 요약만 지운다(그룹에는 남는다) */
export async function removeShare(uid: string, codes: string[]): Promise<void> {
  const { db } = ensure();
  for (const code of codes) await deleteDoc(doc(db, "groups", code, "members", uid)).catch(() => {});
}

/** 그룹 멤버들의 요약 */
export async function pullGroup(code: string): Promise<{ group: ShareGroup; members: { uid: string; summary: ShareSummary }[] } | null> {
  const { db } = ensure();
  const group = await getGroup(code);
  if (!group) return null;
  const snap = await getDocs(collection(db, "groups", code, "members"));
  const members: { uid: string; summary: ShareSummary }[] = [];
  snap.forEach((d) => {
    try {
      members.push({ uid: d.id, summary: JSON.parse(d.data().data as string) as ShareSummary });
    } catch {
      /* 깨진 요약은 건너뛴다 */
    }
  });
  return { group, members };
}

// ───────────── 계정 삭제 ─────────────

/**
 * 계정과 서버의 기록을 모두 지운다: 그룹에서 나가기(만든 그룹은 삭제) → users/{uid} 아래 문서 → 로그인 계정.
 * 이 기기의 기록은 지우지 않는다(백업 내보내기를 할 수 있게). 로그인한 지 오래되면 계정 삭제가 거절되어 다시 로그인을 요구한다.
 */
export async function deleteAccount(uid: string, groupCodes: string[]): Promise<"deleted" | "relogin"> {
  const { auth, db } = ensure();
  // 로그인 계정 삭제는 최근에 로그인했을 때만 된다. 기록만 지우고 계정이 남는 일이 없게 먼저 확인한다
  const user0 = auth.currentUser;
  const last = Date.parse(user0?.metadata.lastSignInTime ?? "");
  if (!user0 || user0.uid !== uid || !(Date.now() - last < 4 * 60_000)) return "relogin";
  for (const code of groupCodes) await leaveGroup(uid, code).catch(() => {});
  const games = await getDocs(collection(db, "users", uid, "games"));
  for (const d of games.docs) await deleteDoc(d.ref);
  await deleteDoc(doc(db, "users", uid, "meta", "settings")).catch(() => {});
  const user = auth.currentUser;
  if (!user || user.uid !== uid) return "deleted";
  try {
    await deleteUser(user);
  } catch (e) {
    if ((e as { code?: string }).code === "auth/requires-recent-login") return "relogin";
    throw e;
  }
  android?.signOut?.();
  return "deleted";
}
