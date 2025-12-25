import { db } from "./firebaseAdmin.js";

/**
 * Retrieve both text and visual chunks with smart ranking
 */
export async function retrieveMultiModalChunks(queryEmbedding, k = 5) {
  console.log("🔎 Retrieving multi-modal chunks...");

  const chunksSnapshot = await db.collection("chunks").get();
  const documentsSnapshot = await db.collection("documents").get();

  // Create document metadata map
  const documentsMap = {};
  documentsSnapshot.forEach((doc) => {
    documentsMap[doc.id] = doc.data();
  });

  const scored = [];

  // Score all chunks
  chunksSnapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.embedding) return;

    const score = cosineSimilarity(queryEmbedding, data.embedding);
    const docMetadata = documentsMap[data.documentId] || {};

    scored.push({
      content: data.content,
      score: score,
      documentId: data.documentId,
      index: data.index,
      documentName: docMetadata.name || "Unknown Document",
      department: docMetadata.department || "Unknown Department",
      fileUrl: docMetadata.fileUrl || null,
      uploadedAt: docMetadata.uploadedAt || null,
      type: data.type || "text",
      metadata: data.metadata || {},
      isVisualContent: data.type === "visual",
    });
  });

  // Sort by score and get top k
  const topChunks = scored.sort((a, b) => b.score - a.score).slice(0, k);

  console.log(`📊 Retrieved ${topChunks.length} chunks:`);
  console.log(
    `   - Text chunks: ${topChunks.filter((c) => c.type === "text").length}`
  );
  console.log(
    `   - Visual chunks: ${topChunks.filter((c) => c.type === "visual").length}`
  );
  console.log(
    `   - Top scores: ${topChunks.map((c) => c.score.toFixed(3)).join(", ")}`
  );

  return topChunks;
}

/**
 * Detect if query is asking for visual content
 * This can be used to boost visual chunks in ranking
 */
export function detectVisualIntent(query) {
  const visualKeywords = [
    "show me",
    "what does",
    "form",
    "application",
    "map",
    "chart",
    "diagram",
    "table",
    "image",
    "picture",
    "visual",
    "looks like",
    "layout",
    "floor plan",
    "campus map",
    "parking",
    "location",
    "building",
  ];

  const lowerQuery = query.toLowerCase();
  return visualKeywords.some((keyword) => lowerQuery.includes(keyword));
}

/**
 * Retrieve chunks with visual content prioritization
 */
export async function retrieveMultiModalChunksWithBoost(
  queryEmbedding,
  query,
  k = 5
) {
  console.log("🔎 Retrieving multi-modal chunks with visual boost...");

  const isVisualQuery = detectVisualIntent(query);
  console.log(`🎯 Visual query detected: ${isVisualQuery}`);

  const chunksSnapshot = await db.collection("chunks").get();
  const documentsSnapshot = await db.collection("documents").get();

  const documentsMap = {};
  documentsSnapshot.forEach((doc) => {
    documentsMap[doc.id] = doc.data();
  });

  const scored = [];

  chunksSnapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.embedding) return;

    let score = cosineSimilarity(queryEmbedding, data.embedding);

    // Boost visual chunks if query asks for visual content
    if (isVisualQuery && data.type === "visual") {
      score = score * 1.3; // 30% boost for visual content
      console.log(`🚀 Boosted visual chunk score: ${score.toFixed(3)}`);
    }

    const docMetadata = documentsMap[data.documentId] || {};

    scored.push({
      content: data.content,
      score: score,
      originalScore: cosineSimilarity(queryEmbedding, data.embedding),
      documentId: data.documentId,
      index: data.index,
      documentName: docMetadata.name || "Unknown Document",
      department: docMetadata.department || "Unknown Department",
      fileUrl: docMetadata.fileUrl || null,
      uploadedAt: docMetadata.uploadedAt || null,
      type: data.type || "text",
      metadata: data.metadata || {},
      isVisualContent: data.type === "visual",
    });
  });

  const topChunks = scored.sort((a, b) => b.score - a.score).slice(0, k);

  console.log(`📊 Retrieved ${topChunks.length} chunks:`);
  console.log(
    `   - Text chunks: ${topChunks.filter((c) => c.type === "text").length}`
  );
  console.log(
    `   - Visual chunks: ${topChunks.filter((c) => c.type === "visual").length}`
  );

  return topChunks;
}

/**
 * Calculate cosine similarity between two vectors
 */
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
