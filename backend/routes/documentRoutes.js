import express from "express";
import { db } from "../config/firebaseAdmin.js";
import admin from "firebase-admin";
import fetch from "node-fetch";
import { requireAdmin } from "../middleware/auth.js";
import { validateFileUrl } from "../utils/fileUrl.js";

const router = express.Router();
const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL || "http://localhost:8000";

// Every route in this file is admin-only (Firebase custom claim `admin: true`).
router.use(requireAdmin);

/** Headers for calling the Python service as the (verified) admin. */
function pythonHeaders(req) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${req.authToken}`,
  };
}

/** Validate admin-supplied document metadata. Returns a list of error strings. */
function validateMetadata(metadata) {
  const errors = [];
  if (!metadata || typeof metadata !== "object") return ["metadata is required"];

  if (typeof metadata.name !== "string" || metadata.name.trim() === "") {
    errors.push("Document name is required");
  }
  if (!metadata.department) errors.push("Department is required");
  if (!metadata.documentType) errors.push("Document type is required");

  if (metadata.effectiveDate && metadata.expiryDate) {
    if (new Date(metadata.expiryDate) <= new Date(metadata.effectiveDate)) {
      errors.push("Expiry date must be after effective date");
    }
  }
  if (metadata.version && !/^v?\d+(\.\d+)*$/.test(metadata.version)) {
    errors.push("Version must be in format: v1.0 or 1.0");
  }
  return errors;
}

/**
 * POST /documents
 * Create the Firestore record for an uploaded document. Replaces the browser
 * writing to Firestore directly; `uploadedBy` comes from the verified token.
 */
router.post("/", async (req, res) => {
  try {
    const { fileUrl, fileSize, metadata } = req.body || {};

    const urlCheck = validateFileUrl(fileUrl);
    if (!urlCheck.ok) {
      return res.status(400).json({ error: "Invalid fileUrl", message: urlCheck.reason });
    }
    const errors = validateMetadata(metadata);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Invalid metadata", errors });
    }

    const tags = Array.isArray(metadata.tags)
      ? metadata.tags
      : typeof metadata.tags === "string" && metadata.tags
      ? metadata.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const docData = {
      name: metadata.name.trim(),
      department: metadata.department,
      documentType: metadata.documentType,
      fileUrl,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      uploadedBy: req.email || req.uid,
      status: "Processing",
      fileSize: Number.isFinite(fileSize) ? fileSize : null,
      academicYear: metadata.academicYear || null,
      programs: Array.isArray(metadata.programs) ? metadata.programs : [],
      years: Array.isArray(metadata.years) ? metadata.years : [],
      tags,
      effectiveDate: metadata.effectiveDate || null,
      expiryDate: metadata.expiryDate || null,
      version: metadata.version || null,
      owner: metadata.owner || null,
      accessLevel: metadata.accessLevel || "Public",
    };

    const docRef = await db.collection("documents").add(docData);
    res.status(201).json({ success: true, documentId: docRef.id });
  } catch (error) {
    console.error("❌ Error creating document:", error);
    res.status(500).json({ error: "Failed to create document" });
  }
});

/**
 * DELETE /documents/:documentId
 * Delete the Firestore record. Replaces the browser deleting it directly.
 * NOTE: chunk / storage / cache cleanup is tracked separately as P0-6.
 */
router.delete("/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;
    const ref = db.collection("documents").doc(documentId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Document not found" });
    }
    await ref.delete();
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error deleting document:", error);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

/**
 * POST /documents/process
 * Process a newly uploaded document via Python RAG service
 */
router.post("/process", async (req, res) => {
  try {
    // Only the id is accepted. The file URL is read from the stored record by
    // the Python service, never taken from the request (SSRF).
    const { documentId } = req.body;

    if (typeof documentId !== "string" || !documentId) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "documentId is required",
      });
    }

    const docRef = db.collection("documents").doc(documentId);
    if (!(await docRef.get()).exists) {
      return res.status(404).json({ error: "Document not found" });
    }

    console.log(`📄 Starting processing for document: ${documentId}`);

    // Update status to processing
    await docRef.update({
      status: "Processing",
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Call Python RAG service
    const response = await fetch(`${PYTHON_RAG_URL}/process-document`, {
      method: "POST",
      headers: pythonHeaders(req),
      body: JSON.stringify({ documentId }),
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
      headers: pythonHeaders(req),
      body: JSON.stringify({ documentId }),
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

router.post("/process-bulk", async (req, res) => {
  try {
    const { documents } = req.body;

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        error: "Invalid request",
        message: "documents array is required",
      });
    }

    console.log(
      `📦 Starting bulk processing for ${documents.length} documents`
    );

    // Update all documents to processing status
    const batch = db.batch();
    documents.forEach((doc) => {
      const docRef = db.collection("documents").doc(doc.documentId);
      batch.update(docRef, {
        status: "Processing",
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    // Call Python RAG service for bulk processing
    const response = await fetch(`${PYTHON_RAG_URL}/process-document-bulk`, {
      method: "POST",
      headers: pythonHeaders(req),
      body: JSON.stringify({
        documents: documents.map((d) => ({ documentId: d.documentId })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Python RAG service error: ${response.statusText}`);
    }

    const result = await response.json();

    console.log(`✅ Bulk processing complete:`, result);

    res.json({
      success: true,
      message: "Bulk processing completed",
      ...result,
    });
  } catch (error) {
    console.error("❌ Error in bulk processing:", error);

    // Update documents to error status
    if (req.body.documents) {
      try {
        const batch = db.batch();
        req.body.documents.forEach((doc) => {
          const docRef = db.collection("documents").doc(doc.documentId);
          batch.update(docRef, {
            status: "Error",
            errorMessage: error.message,
            errorAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      } catch (updateError) {
        console.error("Failed to update error status:", updateError);
      }
    }

    res.status(500).json({
      error: "Failed to process documents in bulk",
      message: error.message,
    });
  }
});

/**
 * POST /documents/check-duplicate
 * Check if document with similar name exists
 */
router.post("/check-duplicate", async (req, res) => {
  try {
    const { name, department } = req.body;

    if (!name || !department) {
      return res.status(400).json({
        error: "name and department are required",
      });
    }

    const response = await fetch(
      `${PYTHON_RAG_URL}/check-duplicate?name=${encodeURIComponent(
        name
      )}&department=${encodeURIComponent(department)}`,
      {
        method: "POST",
        headers: pythonHeaders(req),
      }
    );

    if (!response.ok) {
      throw new Error("Duplicate check failed");
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("❌ Error checking duplicates:", error);
    res.status(500).json({
      error: "Failed to check for duplicates",
      message: error.message,
    });
  }
});

/**
 * GET /documents/processing-status/:documentId
 * Get real-time processing status for a document
 */
router.get("/processing-status/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;

    const docSnapshot = await db.collection("documents").doc(documentId).get();

    if (!docSnapshot.exists) {
      return res.status(404).json({ error: "Document not found" });
    }

    const docData = docSnapshot.data();

    res.json({
      documentId,
      status: docData.status,
      chunksCount: docData.chunksCount,
      textChunks: docData.textChunks,
      visualChunks: docData.visualChunks,
      processedAt: docData.processedAt,
      errorMessage: docData.errorMessage,
    });
  } catch (error) {
    console.error("❌ Error getting processing status:", error);
    res.status(500).json({
      error: "Failed to get processing status",
      message: error.message,
    });
  }
});

/**
 * POST /documents/validate-metadata
 * Validate document metadata before upload
 */
router.post("/validate-metadata", async (req, res) => {
  try {
    const { metadata } = req.body;

    const errors = [];

    // Required fields
    if (!metadata.name || metadata.name.trim() === "") {
      errors.push("Document name is required");
    }

    if (!metadata.department) {
      errors.push("Department is required");
    }

    if (!metadata.documentType) {
      errors.push("Document type is required");
    }

    // Date validation
    if (metadata.effectiveDate && metadata.expiryDate) {
      const effective = new Date(metadata.effectiveDate);
      const expiry = new Date(metadata.expiryDate);

      if (expiry <= effective) {
        errors.push("Expiry date must be after effective date");
      }
    }

    // Version format validation
    if (metadata.version && !/^v?\d+(\.\d+)*$/.test(metadata.version)) {
      errors.push("Version must be in format: v1.0 or 1.0");
    }

    res.json({
      isValid: errors.length === 0,
      errors: errors,
    });
  } catch (error) {
    console.error("❌ Error validating metadata:", error);
    res.status(500).json({
      error: "Failed to validate metadata",
      message: error.message,
    });
  }
});

/**
 * DELETE /documents/cancel-processing/:documentId
 * Cancel ongoing document processing
 */
router.delete("/cancel-processing/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;

    const docRef = db.collection("documents").doc(documentId);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      return res.status(404).json({ error: "Document not found" });
    }

    const docData = docSnapshot.data();

    if (docData.status !== "Processing") {
      return res.status(400).json({
        error: "Document is not currently processing",
        currentStatus: docData.status,
      });
    }

    // Update to cancelled status
    await docRef.update({
      status: "Cancelled",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Delete any chunks that may have been created
    const chunksRef = db
      .collection("chunks")
      .where("documentId", "==", documentId);
    const chunksSnapshot = await chunksRef.get();

    const batch = db.batch();
    chunksSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    console.log(`🚫 Cancelled processing for document: ${documentId}`);

    res.json({
      success: true,
      message: "Processing cancelled and partial data cleaned up",
    });
  } catch (error) {
    console.error("❌ Error cancelling processing:", error);
    res.status(500).json({
      error: "Failed to cancel processing",
      message: error.message,
    });
  }
});

export default router;
