import { db } from "./firebaseAdmin.js";

function cosineSimilarity(a, b) {
  let dot = 0,
    magA = 0,
    magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * 🔑 Definition retrieval
 * Finds chunks that contain the key terms from the question
 */
export async function retrieveDefinitionChunk(question) {
  const snapshot = await db.collection("chunks").get();
  const normalized = question.toLowerCase();

  // Extract key terms from the question
  const keyTerms = normalized
    .replace(/^(what is|what are|define|what does)\s+/i, "")
    .replace(/[?.,!]/g, "")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 3); // Ignore short words like "the", "is"

  let bestMatch = null;
  let highestScore = 0;

  snapshot.forEach((doc) => {
    const text = doc.data().content.toLowerCase();

    // Count how many key terms appear in this chunk
    let score = 0;
    keyTerms.forEach((term) => {
      if (text.includes(term)) {
        score++;
      }
    });

    // Bonus: Check if chunk contains heading-like patterns
    if (text.match(new RegExp(`${keyTerms[0]}[:\\s]`, "i"))) {
      score += 2;
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = doc.data();
    }
  });

  return bestMatch;
}

/**
 * 🔍 Semantic retrieval
 */
export async function retrieveSemanticChunks(queryEmbedding, k = 5) {
  const snapshot = await db.collection("chunks").get();
  const scored = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.embedding) return;

    const score = cosineSimilarity(queryEmbedding, data.embedding);

    scored.push({
      content: data.content,
      score,
    });
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
