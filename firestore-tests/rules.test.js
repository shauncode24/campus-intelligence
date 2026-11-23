import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
} from "firebase/firestore";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-campus-intel",
    firestore: {
      rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
      host: "127.0.0.1",
      port: 8089,
    },
  });
});

after(async () => env?.cleanup());

// Seed data with rules disabled (this is what the Admin SDK effectively does).
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "documents/processed1"), { name: "Public Doc", status: "Processed" });
    await setDoc(doc(db, "documents/processing1"), { name: "Draft", status: "Processing" });
    await setDoc(doc(db, "users/alice"), { email: "a@x.com", role: "user" });
    await setDoc(doc(db, "users/bob"), { email: "b@x.com", role: "user" });
    await setDoc(doc(db, "chunks/c1"), { content: "secret", embedding: [1, 2] });
    await setDoc(doc(db, "questions/q1"), { question: "private?", answer: "a" });
    await setDoc(doc(db, "user_questions/h1"), { userId: "alice", questionText: "mine" });
    await setDoc(doc(db, "chats/chat1"), { userId: "alice" });
    await setDoc(doc(db, "chat_messages/m1"), { chatId: "chat1", content: "hi" });
    await setDoc(doc(db, "user_calendar_tokens/alice"), { tokens: { refresh_token: "r" } });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const alice = () => env.authenticatedContext("alice").firestore();
const guest = () =>
  env.authenticatedContext("guest1", { firebase: { sign_in_provider: "anonymous" } }).firestore();
const admin = () => env.authenticatedContext("boss", { admin: true }).firestore();
// A user who merely *claims* admin in their profile document must gain nothing.
const fakeAdminByProfile = () => env.authenticatedContext("mallory").firestore();

// ---------- documents ----------
test("anyone can read a Processed document", async () => {
  await assertSucceeds(getDoc(doc(anon(), "documents/processed1")));
  await assertSucceeds(getDoc(doc(guest(), "documents/processed1")));
});

test("public library query (status == Processed) works for visitors", async () => {
  const q = query(collection(anon(), "documents"), where("status", "==", "Processed"));
  await assertSucceeds(getDocs(q));
});

test("non-admins cannot read non-Processed documents", async () => {
  await assertFails(getDoc(doc(anon(), "documents/processing1")));
  await assertFails(getDoc(doc(alice(), "documents/processing1")));
});

test("non-admins cannot list ALL documents", async () => {
  await assertFails(getDocs(collection(alice(), "documents")));
});

test("admin can read and list every document", async () => {
  await assertSucceeds(getDoc(doc(admin(), "documents/processing1")));
  await assertSucceeds(getDocs(collection(admin(), "documents")));
});

test("nobody (not even admin) writes documents from the browser", async () => {
  for (const [label, db] of [["anon", anon()], ["user", alice()], ["guest", guest()], ["admin", admin()]]) {
    await assertFails(addDoc(collection(db, "documents"), { name: label, status: "Processed" }));
    await assertFails(updateDoc(doc(db, "documents/processed1"), { name: "hacked" }));
    await assertFails(deleteDoc(doc(db, "documents/processed1")));
  }
});

// ---------- users ----------
test("user can create their own profile with role 'user'", async () => {
  await assertSucceeds(
    setDoc(doc(env.authenticatedContext("carol").firestore(), "users/carol"), {
      email: "c@x.com", displayName: "C", role: "user", createdAt: new Date(), updatedAt: new Date(),
    })
  );
});

test("user CANNOT create their profile with role 'admin'", async () => {
  await assertFails(
    setDoc(doc(env.authenticatedContext("carol").firestore(), "users/carol"), {
      email: "c@x.com", displayName: "C", role: "admin", createdAt: new Date(), updatedAt: new Date(),
    })
  );
});

test("user CANNOT promote themselves by updating role", async () => {
  await assertFails(updateDoc(doc(alice(), "users/alice"), { role: "admin" }));
});

test("user cannot add arbitrary fields to their profile", async () => {
  await assertFails(updateDoc(doc(alice(), "users/alice"), { isAdmin: true }));
});

test("user can update harmless profile fields", async () => {
  await assertSucceeds(updateDoc(doc(alice(), "users/alice"), { displayName: "Alice!" }));
});

test("user cannot create or edit someone else's profile", async () => {
  await assertFails(setDoc(doc(alice(), "users/dave"), { email: "d@x", role: "user" }));
  await assertFails(updateDoc(doc(alice(), "users/bob"), { displayName: "pwn" }));
});

test("user reads own profile only; cannot read others; cannot delete", async () => {
  await assertSucceeds(getDoc(doc(alice(), "users/alice")));
  await assertFails(getDoc(doc(alice(), "users/bob")));
  await assertFails(getDoc(doc(anon(), "users/alice")));
  await assertFails(deleteDoc(doc(alice(), "users/alice")));
});

test("a profile saying role:'admin' does not grant admin powers", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/mallory"), { email: "m@x", role: "admin" });
  });
  await assertFails(getDoc(doc(fakeAdminByProfile(), "documents/processing1")));
  await assertFails(getDoc(doc(fakeAdminByProfile(), "users/alice")));
});

// ---------- everything else is server-only ----------
for (const path of [
  "chunks/c1",
  "questions/q1",
  "user_questions/h1",
  "chats/chat1",
  "chat_messages/m1",
  "user_calendar_tokens/alice",
  "calendar_oauth_states/x",
  "never_heard_of_it/x",
]) {
  test(`server-only collection denied to everyone, incl. owner/admin: ${path}`, async () => {
    for (const db of [anon(), alice(), guest(), admin()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { x: 1 }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });
}
