/**
 * Everything the service stores about one person, and how to erase it.
 *
 * KEEP THIS LIST IN STEP WITH THE CODE: every collection that stores a user id must be here.
 * tests/api/account_deletion.mjs seeds every collection in USER_COLLECTIONS and also scans the
 * whole database for the uid afterwards, so a collection added elsewhere without being listed
 * here makes that test fail.
 *
 * Not personal data of the user (so not erased): the shared answer cache (`questions`) holds
 * question and answer text keyed by a hash, with no user id; it stops being reused after
 * CACHE_TTL_DAYS and is physically removed by backend/python/scripts/purge_cache.py (run it
 * from time to time) or when a document it cites is deleted or re-processed.
 */

/** Collections whose documents carry the user's id in `field`. */
export const USER_COLLECTIONS = [
  { name: "chat_messages", field: "userId" },
  { name: "chats", field: "userId" },
  { name: "user_questions", field: "userId" },   // history, favourites, personal notes
  { name: "feedback", field: "userId" },          // 👍/👎 with question and answer text
  { name: "calendar_events", field: "userId" },
  { name: "calendar_oauth_states", field: "uid" },
  { name: "llm_usage", field: "uid" },             // how many model calls the person made today
];

/** Collections with one document per user, the document id being the uid. */
export const USER_DOCUMENTS = ["user_calendar_tokens", "users"];

const BATCH = 400;

async function deleteWhere(db, name, field, uid) {
  let deleted = 0;
  for (;;) {
    const snap = await db.collection(name).where(field, "==", uid).limit(BATCH).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
}

/**
 * Delete every record about `uid`. Safe to run again after a failure (it just finds less).
 * @returns {Promise<Record<string, number>>} how many documents were removed per collection
 */
export async function deleteUserData(db, uid) {
  if (typeof uid !== "string" || !uid) throw new Error("uid is required");
  const removed = {};
  for (const { name, field } of USER_COLLECTIONS) {
    removed[name] = await deleteWhere(db, name, field, uid);
  }
  for (const name of USER_DOCUMENTS) {
    const ref = db.collection(name).doc(uid);
    const snap = await ref.get();
    if (snap.exists) await ref.delete();
    removed[name] = snap.exists ? 1 : 0;
  }
  return removed;
}
