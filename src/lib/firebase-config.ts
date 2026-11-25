// Firebase project settings. These are public identifiers (they ship inside the app);
// access to data is protected by the Firestore security rules (DESIGN.md "트래커 계정").
// Until they are filled in, the account features stay hidden.
import type { FirebaseOptions } from "firebase/app";

export const firebaseConfig: FirebaseOptions | null = null;

/** OAuth "web client ID" from Firebase Authentication → Google (used by Android native sign-in). */
export const googleWebClientId: string | null = null;
