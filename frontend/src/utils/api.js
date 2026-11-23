// src/utils/api.js
//
// Authenticated fetch for the backend APIs.
//
// The backend identifies callers ONLY by a verified Firebase ID token, so every
// call to a user-scoped endpoint must go through apiFetch. Visitors who have not
// signed in are given a Firebase *anonymous* account (a real uid, so their chats
// and history are private to them and the server can verify it).
import { signInAnonymously } from "firebase/auth";
import { auth } from "../app/firebase";

let anonymousSignIn = null;

/**
 * Resolve the current Firebase user, creating an anonymous guest if nobody is
 * signed in. Concurrent callers share a single sign-in attempt.
 */
export async function ensureSignedIn() {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;

  if (!anonymousSignIn) {
    anonymousSignIn = signInAnonymously(auth)
      .then((credential) => credential.user)
      .finally(() => {
        anonymousSignIn = null;
      });
  }
  return anonymousSignIn;
}

/**
 * fetch() with `Authorization: Bearer <Firebase ID token>`.
 * The SDK refreshes the token automatically when it is close to expiry.
 */
export async function apiFetch(url, options = {}) {
  const user = await ensureSignedIn();
  const token = await user.getIdToken();

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(url, { ...options, headers });
}
