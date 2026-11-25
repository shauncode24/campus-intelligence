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
import { freshRef } from "./errorRef";

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
export const DEFAULT_TIMEOUT_MS = 30000;

let lastServerFailure = null;

/**
 * The request id of the most recent failed (5xx) call, if it was in the last 15 seconds. The
 * servers put the same id in their logs, so quoting it lets whoever runs the service find the
 * failure. Used by handleError to add "(ref ...)" to error messages.
 */
export function recentServerRef(now = Date.now()) {
  return freshRef(lastServerFailure, now);
}

/**
 * Waiting for an answer from the server is limited (`timeoutMs`, default 30 s; 0 = no limit):
 * the time until the response STARTS. A streaming answer therefore keeps flowing, but a server
 * that never answers no longer leaves the screen spinning forever. A `signal` given by the caller
 * still aborts the request, including a stream that is already running.
 */
export async function apiFetch(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = options;
  const user = await ensureSignedIn();
  const token = await user.getIdToken();

  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    const response = await fetch(url, { ...rest, headers, signal: controller.signal });
    if (response.status >= 500) {
      lastServerFailure = { ref: response.headers.get("X-Request-ID"), at: Date.now() };
    }
    return response;
  } catch (error) {
    if (timedOut) {
      const timeout = new Error("The server took too long to answer.");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
