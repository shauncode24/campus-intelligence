import express from "express";
import { db } from "../config/firebaseAdmin.js";
import admin from "firebase-admin";
import fetch from "node-fetch";

const router = express.Router();
const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL || "http://localhost:8000";

/**
 * POST /documents/process
 * Process a newly uploaded document via Python RAG service
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

    // Update status to processing
    await db.collection("documents").doc(documentId).update({
      status: "Processing",
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Call Python RAG service
    const response = await fetch(`${PYTHON_RAG_URL}/process-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentId: documentId,
        fileUrl: fileUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Python RAG service error: ${response.statusText}`);
    }

    const result = await response.json();

    console.log(`✅ Processing complete:`, result);

    res.json({
      success: true,
      message: "Document processed successfully",
      ...result,
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

    console.log(`🔄 Reprocessing document: ${documentId}`);

    // Update status to processing
    await db.collection("documents").doc(documentId).update({
      status: "Processing",
      reprocessingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Call Python RAG service
    const response = await fetch(`${PYTHON_RAG_URL}/process-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentId: documentId,
        fileUrl: docData.fileUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Python RAG service error: ${response.statusText}`);
    }

    const result = await response.json();

    console.log(`✅ Reprocessing complete:`, result);

    res.json({
      success: true,
      message: "Document reprocessed successfully",
      ...result,
    });
  } catch (error) {
    console.error("❌ Error reprocessing document:", error);
    res.status(500).json({
      error: "Failed to reprocess document",
      message: error.message,
    });
  }
});

/**
 * GET /documents/rag-status
 * Check Python RAG service status
 */
router.get("/rag-status", async (req, res) => {
  try {
    const response = await fetch(`${PYTHON_RAG_URL}/health`);

    if (!response.ok) {
      throw new Error("RAG service unhealthy");
    }

    const status = await response.json();
    res.json(status);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
    });
  }
});

export default router;
