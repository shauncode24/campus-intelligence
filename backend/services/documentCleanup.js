/**
 * Cleanup of data derived from a document: its chunks and any cached answers
 * that cite it. Used by delete, reprocess and cancel so they stay consistent.
 *
 * Firestore allows at most 500 operations per batch, so everything here works
 * in bounded batches.
 */
const BATCH_SIZE = 450;

/**
 * Delete every chunk belonging to a document. Safe to call repeatedly.
 * @returns {Promise<number>} number of chunks deleted
 */
export async function deleteChunksForDocument(db, documentId) {
  let total = 0;
  for (;;) {
    const snap = await db
      .collection("chunks")
      .where("documentId", "==", documentId)
      .select() // ids only: do not download the embeddings just to delete them
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) return total;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
}

/**
 * Delete cached answers (the `questions` collection, which also feeds the FAQ)
 * whose sources cite this document, so a deleted or re-indexed document can
 * never keep being served from the cache.
 *
 * `sources` is an array of maps, which Firestore cannot query by inner field,
 * so this scans `questions` once (only the `sources`/`documentIds` fields are
 * read). That is acceptable for a rare admin action; if the cache grows large,
 * store a flat `documentIds` array on each entry and query it instead.
 *
 * @returns {Promise<number>} number of cache entries removed
 */
export async function invalidateCachedAnswers(db, documentId) {
  let removed = 0;
  let pending = 0;
  let batch = db.batch();

  const stream = db.collection("questions").select("sources", "documentIds").stream();
  for await (const doc of stream) {
    const data = doc.data();
    const cites =
      (Array.isArray(data.documentIds) && data.documentIds.includes(documentId)) ||
      (Array.isArray(data.sources) &&
        data.sources.some((s) => s && s.documentId === documentId));
    if (!cites) continue;

    batch.delete(doc.ref);
    removed++;
    pending++;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return removed;
}
