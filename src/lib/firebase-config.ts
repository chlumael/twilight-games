// Firebase project settings. These are public identifiers (they ship inside the app);
// access to data is protected by the Firestore security rules (DESIGN.md §8-2).
import type { FirebaseOptions } from "firebase/app";

export const firebaseConfig: FirebaseOptions | null = {
  apiKey: "AIzaSyBxn-Zk6PP3JEN536SGYov1-Lmrtu9hJKk",
  authDomain: "twilight-games.firebaseapp.com",
  projectId: "twilight-games",
  storageBucket: "twilight-games.firebasestorage.app",
  messagingSenderId: "32405164207",
  appId: "1:32405164207:web:e20509852c60184a5dc45a",
};

/** OAuth "web client ID" from Firebase Authentication → Google (used by Android native sign-in). */
export const googleWebClientId: string | null =
  "32405164207-6b0mmdlfbkkccf3fr7jo5fsr61i7ei3m.apps.googleusercontent.com";
