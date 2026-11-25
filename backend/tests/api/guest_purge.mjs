// P1-10: unused guest accounts are erased with their data; signed-up and recent guests never.
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
const { purgeInactiveGuests, isGuest, lastActive } = await import("../../services/guestPurge.js");
const db = admin.firestore();

let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const NOW = Date.parse("2026-11-25T00:00:00Z");
const ago = (days) => new Date(NOW - days * 864e5).toUTCString();
const user = (uid, { email, providers = [], signedIn, created = signedIn } = {}) => ({
  uid, email, providerData: providers, metadata: { lastSignInTime: signedIn ? ago(signedIn) : undefined, creationTime: ago(created ?? 0) },
});

const users = [
  user("old-guest", { signedIn: 90 }),
  user("recent-guest", { signedIn: 5 }),
  user("never-signed-in-old-guest", { created: 200 }),
  user("old-member", { email: "a@campus.edu", providers: [{ providerId: "password" }], signedIn: 400 }),
  user("old-member-no-email-google", { providers: [{ providerId: "google.com" }], signedIn: 400 }),
];
const deleted = [];
const auth = {
  listUsers: async (max, token) => token ? { users: users.slice(3), pageToken: undefined } : { users: users.slice(0, 3), pageToken: "next" },
  deleteUsers: async (uids) => { deleted.push(...uids); },
};

for (const uid of ["old-guest", "recent-guest", "old-member", "never-signed-in-old-guest"]) {
  await db.collection("chats").add({ userId: uid, title: uid });
  await db.collection("user_questions").add({ userId: uid, questionText: "private" });
}
const chatsOf = async (uid) => (await db.collection("chats").where("userId", "==", uid).get()).size;

check("who is a guest", isGuest(users[0]) && !isGuest(users[3]) && !isGuest(users[4]));
check("last activity falls back to creation", lastActive(users[2]) === NOW - 200 * 864e5);

let r = await purgeInactiveGuests({ auth, db, maxAgeDays: 60, dryRun: true, now: NOW });
check("dry run reports but changes nothing", r.purged === 2 && deleted.length === 0 && (await chatsOf("old-guest")) === 1);
check("counts across pages", r.scanned === 5 && r.guests === 3 && r.kept === 1);

r = await purgeInactiveGuests({ auth, db, maxAgeDays: 60, now: NOW });
check("the two unused guests are erased (accounts)", r.purged === 2 && deleted.sort().join() === "never-signed-in-old-guest,old-guest");
check("...with all their data", (await chatsOf("old-guest")) === 0 && (await chatsOf("never-signed-in-old-guest")) === 0
  && (await db.collection("user_questions").where("userId", "==", "old-guest").get()).size === 0);
check("a recent guest is kept", (await chatsOf("recent-guest")) === 1);
check("a member is never touched, however old", (await chatsOf("old-member")) === 1 && !deleted.includes("old-member"));

let threw = false;
try { await purgeInactiveGuests({ auth, db, maxAgeDays: 1, now: NOW }); } catch { threw = true; }
check("a too-short retention is refused (a typo must not wipe everyone)", threw);

// data erased first: if the data step fails the account stays so the next run retries
deleted.length = 0;
const failing = { ...auth, listUsers: async () => ({ users: [user("g2", { signedIn: 99 })] }) };
const brokenDb = { collection: () => { throw new Error("db down"); } };
let failedRun = null;
try { await purgeInactiveGuests({ auth: failing, db: brokenDb, now: NOW }); } catch (e) { failedRun = e; }
check("if erasing the data fails, the account is not deleted", failedRun && deleted.length === 0);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
