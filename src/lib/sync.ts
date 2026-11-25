// Tracker account: Google sign-in + per-game documents in Firestore.
//   users/{uid}/games/{gameId}  = { data: JSON(GameRecord), updatedAt }
//   users/{uid}/meta/settings   = { data: JSON(Settings), updatedAt }
// Local storage stays the source of truth while offline; see merge.ts for how copies combine.
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut,
  type Auth, type User,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, getFirestore, setDoc, type Firestore } from "firebase/firestore/lite";
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
