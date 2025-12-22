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
 * 🔒 Definition retrieval
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
    .filter((word) => word.length > 3);

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
 * 🔍 Semantic retrieval with document metadata
 */
export async function retrieveSemanticChunks(queryEmbedding, k = 5) {
  const chunksSnapshot = await db.collection("chunks").get();
  const scored = [];

  // Get all document metadata once
  const documentsSnapshot = await db.collection("documents").get();
  const documentsMap = {};

  documentsSnapshot.forEach((doc) => {
    documentsMap[doc.id] = doc.data();
  });

  chunksSnapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.embedding) return;

    const score = cosineSimilarity(queryEmbedding, data.embedding);

    // Get document metadata
    const docMetadata = documentsMap[data.documentId] || {};

    scored.push({
      content: data.content,
      score,
      documentId: data.documentId,
      index: data.index,
      documentName: docMetadata.name || "Unknown Document",
      department: docMetadata.department || "Unknown Department",
      fileUrl: docMetadata.fileUrl || null,
      uploadedAt: docMetadata.uploadedAt || null,
    });
  });

  // Sort by score and return top k
  const topChunks = scored.sort((a, b) => b.score - a.score).slice(0, k);

  console.log(`🔍 Retrieved ${topChunks.length} chunks with document metadata`);
  console.log(
    `📊 Top scores: ${topChunks.map((c) => c.score.toFixed(3)).join(", ")}`
  );

  return topChunks;
}
