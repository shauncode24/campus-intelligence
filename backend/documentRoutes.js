import express from "express";
import { db } from "./firebaseAdmin.js";
import { processDocument } from "./processDocuments.js";
import { getEmbedding } from "./embedding.js";
import admin from "firebase-admin";

const router = express.Router();

/**
 * POST /documents/process
 * Process a newly uploaded document - chunk and embed it
 */
router.post("/process", async (req, res) => {
  try {
    const { documentId, fileUrl } = req.body;

    if (!documentId || !fileUrl) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "documentId and fileUrl are required",
      });
    }

    console.log(`📄 Starting processing for document: ${documentId}`);

    // Step 1: Process and chunk the document
    const chunkResult = await processDocument(documentId, fileUrl);
    console.log(`✅ Created ${chunkResult.chunksCount} chunks`);

    // Step 2: Generate embeddings for all chunks
    const chunksSnapshot = await db
      .collection("chunks")
      .where("documentId", "==", documentId)
      .get();

    let embeddedCount = 0;
    const batch = db.batch();

    for (const doc of chunksSnapshot.docs) {
      const data = doc.data();

      // Skip if already has embedding
      if (data.embedding) {
        console.log(`⏭️  Chunk ${doc.id} already has embedding`);
        continue;
      }

      console.log(`🔢 Generating embedding for chunk ${doc.id}`);
      const embedding = await getEmbedding(data.content);

      batch.update(doc.ref, { embedding });
      embeddedCount++;
    }

    await batch.commit();
    console.log(`✅ Generated ${embeddedCount} embeddings`);

    // Step 3: Update document status
    await db.collection("documents").doc(documentId).update({
      status: "Processed",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      chunksCount: chunkResult.chunksCount,
      embeddedCount: embeddedCount,
    });

    res.json({
      success: true,
      message: "Document processed successfully",
      documentId,
      chunksCount: chunkResult.chunksCount,
      embeddedCount: embeddedCount,
    });
  } catch (error) {
    console.error("❌ Error processing document:", error);

    // Update document status to error
    if (req.body.documentId) {
      try {
        await db.collection("documents").doc(req.body.documentId).update({
          status: "Error",
          errorMessage: error.message,
          errorAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (updateError) {
        console.error("Failed to update error status:", updateError);
      }
    }

    res.status(500).json({
      error: "Failed to process document",
      message: error.message,
    });
  }
});

/**
 * POST /documents/reprocess
 * Reprocess an existing document
 */
router.post("/reprocess", async (req, res) => {
  try {
    const { documentId } = req.body;

    if (!documentId) {
      return res.status(400).json({ error: "documentId is required" });
    }

    // Get document details
    const docSnapshot = await db.collection("documents").doc(documentId).get();

    if (!docSnapshot.exists) {
      return res.status(404).json({ error: "Document not found" });
    }

    const docData = docSnapshot.data();

    // Delete old chunks
    const oldChunks = await db
      .collection("chunks")
      .where("documentId", "==", documentId)
      .get();

    const deleteBatch = db.batch();
    oldChunks.docs.forEach((doc) => {
      deleteBatch.delete(doc.ref);
    });
    await deleteBatch.commit();

    console.log(`🗑️  Deleted ${oldChunks.size} old chunks`);

    // Update status to pending
    await db.collection("documents").doc(documentId).update({
      status: "Processing",
      reprocessedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Process the document
    const chunkResult = await processDocument(documentId, docData.fileUrl);
    console.log(`✅ Created ${chunkResult.chunksCount} new chunks`);

    // Generate embeddings
    const chunksSnapshot = await db
      .collection("chunks")
      .where("documentId", "==", documentId)
      .get();

    let embeddedCount = 0;
    const embedBatch = db.batch();

    for (const doc of chunksSnapshot.docs) {
      const data = doc.data();
      console.log(`🔢 Generating embedding for chunk ${doc.id}`);
      const embedding = await getEmbedding(data.content);
      embedBatch.update(doc.ref, { embedding });
      embeddedCount++;
    }

    await embedBatch.commit();
    console.log(`✅ Generated ${embeddedCount} embeddings`);

    // Update document status
    await db.collection("documents").doc(documentId).update({
      status: "Processed",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      chunksCount: chunkResult.chunksCount,
      embeddedCount: embeddedCount,
    });

    res.json({
      success: true,
      message: "Document reprocessed successfully",
      documentId,
      chunksCount: chunkResult.chunksCount,
      embeddedCount: embeddedCount,
    });
  } catch (error) {
    console.error("❌ Error reprocessing document:", error);
    res.status(500).json({
      error: "Failed to reprocess document",
      message: error.message,
    });
  }
});

export default router;

// Add to index.js:
// import documentRoutes from "./documentRoutes.js";
// app.use("/documents", documentRoutes);
