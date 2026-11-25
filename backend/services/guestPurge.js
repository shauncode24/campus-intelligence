/**
 * Retention for guests (P1-10, S9): a guest is an anonymous account created automatically for
 * every visitor. Nobody ever deletes theirs, so without this the database fills with chats of
 * people who never came back. Guests unused for `maxAgeDays` are erased (all their data, then the
 * account). Signed-up accounts are never touched.
 *
 *   node scripts/purgeGuests.js --days 60 --dry-run     # see what would go
 *   node scripts/purgeGuests.js --days 60               # do it (run it from a monthly scheduler)
 */
import { deleteUserData } from "./userData.js";

const DAY = 24 * 60 * 60 * 1000;

/** A guest has no email and no sign-in provider (email/password, Google...). */
export function isGuest(user) {
  return !user.email && (!user.providerData || user.providerData.length === 0);
}

/** When the account was last used: its latest sign-in or token refresh, else when it was created. */
export function lastActive(user) {
  const m = user.metadata || {};
  const times = [m.lastSignInTime, m.lastRefreshTime, m.creationTime].map((t) => Date.parse(t || "")).filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

/**
 * @param {{auth: object, db: object, maxAgeDays?: number, dryRun?: boolean, now?: number}} options
 * @returns {Promise<{scanned: number, guests: number, purged: number, kept: number}>}
 */
export async function purgeInactiveGuests({ auth, db, maxAgeDays = 60, dryRun = false, now = Date.now() }) {
  if (!(maxAgeDays >= 7)) throw new Error("maxAgeDays must be at least 7 (a guest may just be away for a week)");
  const cutoff = now - maxAgeDays * DAY;
  const result = { scanned: 0, guests: 0, purged: 0, kept: 0 };
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    pageToken = page.pageToken;
    const doomed = [];
    for (const user of page.users) {
      result.scanned++;
      if (!isGuest(user)) continue;
      result.guests++;
      if (lastActive(user) < cutoff) doomed.push(user.uid);
      else result.kept++;
    }
    for (const uid of doomed) {
      if (!dryRun) await deleteUserData(db, uid);       // data first: a failure leaves the account to retry
      result.purged++;
    }
    if (!dryRun && doomed.length) await auth.deleteUsers(doomed);
  } while (pageToken);
  return result;
}
