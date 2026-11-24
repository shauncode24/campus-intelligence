import express from "express";
import { db } from "../config/firebaseAdmin.js";
import admin from "firebase-admin";
import fetch from "node-fetch";
import { requireAdmin } from "../middleware/auth.js";
import { adminUserLimiter } from "../middleware/rateLimit.js";
import { failInternal } from "../utils/httpErrors.js";
import { validateFileUrl } from "../utils/fileUrl.js";
import { deleteChunksForDocument, invalidateCachedAnswers, bumpCorpusEpoch } from "../services/documentCleanup.js";
import { deleteDocumentFile } from "../services/fileStorage.js";

const router = express.Router();
const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL || "http://localhost:8000";

// Every route in this file is admin-only (Firebase custom claim `admin: true`).
router.use(requireAdmin, adminUserLimiter);

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
    const { fileUrl, fileSize, metadata, supersedes } = req.body || {};

    const urlCheck = validateFileUrl(fileUrl);
    if (!urlCheck.ok) {
      return res.status(400).json({ error: "Invalid fileUrl", message: urlCheck.reason });
    }
    const errors = validateMetadata(metadata);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Invalid metadata", errors });
    }

    // "This is the new version of document X": X must exist, be live, and not already
    // have been replaced. X keeps answering until the new document finishes processing;
    // only then does the processing job retire it.
    let supersededDoc = null;
    if (supersedes !== undefined && supersedes !== null && supersedes !== "") {
      if (typeof supersedes !== "string" || supersedes.length > 128 || supersedes.includes("/")) {
        return res.status(400).json({ error: "Invalid supersedes", message: "supersedes must be a document id" });
      }
      const oldSnap = await db.collection("documents").doc(supersedes).get();
      if (!oldSnap.exists) {
        return res.status(400).json({ error: "Invalid supersedes", message: "The document to replace does not exist" });
      }
      const old = oldSnap.data();
      if (old.supersededBy) {
        return res.status(400).json({ error: "Invalid supersedes", message: "That document has already been replaced by a newer version" });
      }
      supersededDoc = supersedes;
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
      ...(supersededDoc ? { supersedes: supersededDoc } : {}),
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
 *
 * Removes a document and everything derived from it, in an order that is safe
 * to retry if any step fails:
 *   1. mark it "Deleting" (retrieval ignores anything not "Processed", so it
 *      stops being used for answers immediately)
 *   2. delete its chunks (batched; no 500-operation limit problem)
 *   3. delete cached answers that cite it (they also feed the FAQ)
 *   4. delete the stored file (best effort; reported, never blocks)
 *   5. delete the record itself
 * If steps 2-3 throw, the record stays as "Deleting" and the admin can simply
 * call this again.
 */
router.delete("/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;
    const ref = db.collection("documents").doc(documentId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Document not found" });
    }
    const { fileUrl, supersedes } = snap.data();

    await ref.update({
      status: "Deleting",
      deletingAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const chunksDeleted = await deleteChunksForDocument(db, documentId);
    const cacheEntriesRemoved = await invalidateCachedAnswers(db, documentId);
    const file = await deleteDocumentFile(fileUrl);
    if (!file.deleted) {
      console.warn(`⚠️ File for ${documentId} not removed from storage: ${file.reason}`);
    }

    // If this document had replaced an older version, the older one is current again
    let reinstated = null;
    if (typeof supersedes === "string" && supersedes) {
      try {
        const oldRef = db.collection("documents").doc(supersedes);
        const oldSnap = await oldRef.get();
        if (oldSnap.exists && oldSnap.data().supersededBy === documentId) {
          await oldRef.update({
            supersededBy: admin.firestore.FieldValue.delete(),
            supersededAt: admin.firestore.FieldValue.delete(),
          });
          reinstated = supersedes;
        }
      } catch (e) {
        console.error("Could not reinstate the previous version:", e);
      }
    }

    await ref.delete();
    // The documents that can answer questions changed: no earlier cached answer may be reused
    await bumpCorpusEpoch(db, admin);

    res.json({ success: true, chunksDeleted, cacheEntriesRemoved, file, reinstated });
  } catch (error) {
    console.error("❌ Error deleting document:", error);
    res.status(500).json({
      error: "Failed to delete document",
      message: "Deletion did not finish. The document is hidden from answers; try deleting it again.",
    });
  }
});

/**
 * Ask the Python service to start processing a document. It answers 202 at once and
 * does the work in the background; progress and the outcome are written to the
 * document record (`status`, `processing`, `errorMessage`).
 *
 * Returns {accepted: true} or {accepted: false, status, message} for a refusal that
 * is the caller's business (409: already being processed, 404, 400: unsafe address).
 * Anything else throws.
 */
async function startProcessing(req, documentId) {
  const response = await fetch(`${PYTHON_RAG_URL}/process-document`, {
    method: "POST",
    headers: pythonHeaders(req),
    body: JSON.stringify({ documentId }),
  });
  if (response.status === 202 || response.ok) {
    return { accepted: true };
  }
  if ([400, 404, 409].includes(response.status)) {
    const body = await response.json().catch(() => ({}));
    return {
      accepted: false,
      status: response.status,
      message: typeof body.detail === "string" ? body.detail : "The document could not be processed",
    };
  }
  throw new Error(`Python RAG service error: ${response.status}`);
}

/** Mark a document as failed so it never stays stuck in "Processing". */
async function recordFailure(documentId, error) {
  try {
    await db.collection("documents").doc(documentId).update({
      status: "Error",
      errorMessage: "Could not start processing. Please try again.",
      errorDetail: String(error.message || error).slice(0, 500), // admin-only record
      errorAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (updateError) {
    console.error("Failed to update error status:", updateError);
  }
}

/**
 * POST /documents/process   and   POST /documents/reprocess
 *
 * Start (re)processing a document. Returns 202 immediately; poll
 * GET /documents/processing-status/:documentId for real progress.
 * Only the id is accepted: the file URL is read from the stored record by the
 * Python service, never taken from the request (SSRF).
 */
function processHandler({ reprocess }) {
  return async (req, res) => {
    const documentId = req.body && req.body.documentId;
    try {
      if (typeof documentId !== "string" || !documentId) {
        return res.status(400).json({
          error: "Missing required fields",
          message: "documentId is required",
        });
      }

      const docRef = db.collection("documents").doc(documentId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Document not found" });
      }
      const previous = snap.data();
      if (previous.status === "Deleting") {
        return res.status(409).json({ error: "Document is being deleted" });
      }

      console.log(`${reprocess ? "🔄 Reprocessing" : "📄 Starting processing for"} document: ${documentId}`);

      // Python sets "Processing" itself once it accepts; setting it here too keeps the
      // UI right if Python is slow to answer.
      await docRef.update({
        status: "Processing",
        [reprocess ? "reprocessingStartedAt" : "processingStartedAt"]:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      let started;
      try {
        started = await startProcessing(req, documentId);
      } catch (error) {
        await recordFailure(documentId, error);
        throw error;
      }

      if (!started.accepted) {
        // Not started: put the document back the way it was (a 409 means a job is
        // already running, which still shows "Processing").
        if (started.status !== 409) {
          await docRef.update({ status: previous.status || "Error" });
        }
        return res.status(started.status).json({ error: started.message, message: started.message });
      }

      // The re-indexed content may differ, so cached answers citing this document are
      // no longer trustworthy. The document is hidden from answers until it finishes,
      // so nothing new can be cached from it in the meantime.
      let cacheEntriesRemoved;
      if (reprocess) {
        cacheEntriesRemoved = await invalidateCachedAnswers(db, documentId);
      }

      res.status(202).json({
        success: true,
        accepted: true,
        documentId,
        status: "Processing",
        message: "Processing started",
        ...(reprocess ? { cacheEntriesRemoved } : {}),
      });
    } catch (error) {
      console.error(`❌ Error starting ${reprocess ? "reprocessing" : "processing"}:`, error);
      failInternal(res, error, reprocess ? "Failed to reprocess document" : "Failed to process document");
    }
  };
}

router.post("/process", processHandler({ reprocess: false }));
router.post("/reprocess", processHandler({ reprocess: true }));

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
      error: "RAG service unavailable",
    });
  }
});

/**
 * POST /documents/check-duplicate
 * Check if document with similar name exists
 */
router.post("/check-duplicate", async (req, res) => {
  try {
    const { name, department, sha256 } = req.body || {};

    const hasHash = typeof sha256 === "string" && /^[0-9a-fA-F]{64}$/.test(sha256);
    const hasNameAndDept =
      typeof name === "string" && name.trim() && typeof department === "string" && department.trim();
    if (sha256 !== undefined && sha256 !== "" && !hasHash) {
      return res.status(400).json({ error: "sha256 must be 64 hex characters" });
    }
    if (!hasHash && !hasNameAndDept) {
      return res.status(400).json({ error: "Give a sha256, or a name and a department" });
    }

    const params = new URLSearchParams();
    if (hasNameAndDept) {
      params.set("name", name.trim().slice(0, 300));
      params.set("department", department.trim().slice(0, 100));
    }
    if (hasHash) params.set("sha256", sha256.toLowerCase());

    const response = await fetch(`${PYTHON_RAG_URL}/check-duplicate?${params}`, {
      method: "POST",
      headers: pythonHeaders(req),
    });

    if (!response.ok) {
      throw new Error("Duplicate check failed");
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("❌ Error checking duplicates:", error);
    failInternal(res, error, "Failed to check for duplicates");
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
      // real progress written by the processing job: {stage, percent, message, ...}
      processing: docData.processing || null,
      chunksCount: docData.chunksCount,
      textChunks: docData.textChunks,
      visualChunks: docData.visualChunks,
      imageStats: docData.imageStats || null,
      processedAt: docData.processedAt,
      errorMessage: docData.errorMessage,
    });
  } catch (error) {
    console.error("❌ Error getting processing status:", error);
    failInternal(res, error, "Failed to get processing status");
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

    // Delete any chunks that may have been created (batched: Firestore allows
    // at most 500 operations per batch, so a large document used to fail here)
    await deleteChunksForDocument(db, documentId);

    console.log(`🚫 Cancelled processing for document: ${documentId}`);

    res.json({
      success: true,
      message: "Processing cancelled and partial data cleaned up",
    });
  } catch (error) {
    console.error("❌ Error cancelling processing:", error);
    failInternal(res, error, "Failed to cancel processing");
  }
});

export default router;
