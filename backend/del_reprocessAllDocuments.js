// import { db } from "./firebaseAdmin.js";
// import { processDocument } from "./processDocuments.js";
// import { getEmbedding } from "./embedding.js";

// async function reprocessAll() {
//   console.log("🗑️  Deleting old chunks...");

//   // Delete all old chunks
//   const oldChunks = await db.collection("chunks").get();
//   const batch = db.batch();

//   oldChunks.docs.forEach((doc) => {
//     batch.delete(doc.ref);
//   });

//   await batch.commit();
//   console.log(`✅ Deleted ${oldChunks.size} old chunks`);

//   console.log("\n📄 Re-processing documents with new chunking...");

//   // Re-process all documents
//   const docsSnapshot = await db.collection("documents").get();

//   for (const doc of docsSnapshot.docs) {
//     const docId = doc.id;
//     const data = doc.data();

//     console.log(`\n📝 Processing: ${data.name}`);
//     await processDocument(docId, data.fileUrl);
//   }

//   console.log("\n🔢 Generating embeddings for new chunks...");

//   // Generate embeddings for all new chunks
//   const newChunks = await db.collection("chunks").get();

//   for (const doc of newChunks.docs) {
//     const data = doc.data();

//     if (data.embedding) {
//       console.log(`⏭️  Skipping (already has embedding): chunk ${doc.id}`);
//       continue;
//     }

//     console.log(`🔢 Embedding chunk ${doc.id}`);
//     // const embedding = await getEmbedding(data.content);

//     // await doc.ref.update({ embedding });
//   }

//   console.log("\n✅ ALL DONE! Your RAG system is ready.");
//   console.log(`📊 Total chunks: ${newChunks.size}`);
// }

// reprocessAll().catch(console.error);
