import express from "express";
import admin from "firebase-admin";
import { db } from "../config/firebaseAdmin.js";
import { requireAdmin } from "../middleware/auth.js";
import { adminUserLimiter } from "../middleware/rateLimit.js";
import { failInternal } from "../utils/httpErrors.js";

/**
 * Admin management of the curated FAQ (`faqs` collection).
 *
 * The public FAQ page shows ONLY entries written here and marked published.
 * It is never generated from users' questions: those can contain personal
 * circumstances, and an answer cached for one person is not a published fact.
 * Clients cannot touch this collection directly (Firestore rules deny it);
 * the public read is served by the RAG service (GET /faq).
 */
const router = express.Router();
router.use(requireAdmin, adminUserLimiter);

const CATEGORIES = ["deadline", "procedure", "requirement", "definition", "general"];
const MAX_FAQS = 500;

/**
 * Validate and normalise a request body.
 * @returns {{ errors: string[], value?: object }}
 */
function parseFaq(body) {
  const errors = [];
  const b = body && typeof body === "object" ? body : {};

  const question = typeof b.question === "string" ? b.question.trim() : "";
  const answer = typeof b.answer === "string" ? b.answer.trim() : "";
  if (question.length < 5 || question.length > 300) {
    errors.push("Question must be 5 to 300 characters");
  }
  if (answer.length < 1 || answer.length > 5000) {
    errors.push("Answer must be 1 to 5000 characters");
  }

  const intent = b.category === undefined ? "general" : b.category;
  if (!CATEGORIES.includes(intent)) {
    errors.push(`Category must be one of: ${CATEGORIES.join(", ")}`);
  }

  const order = b.order === undefined || b.order === "" ? 100 : Number(b.order);
  if (!Number.isInteger(order) || order < 0 || order > 9999) {
    errors.push("Order must be a whole number from 0 to 9999");
  }

  if (b.published !== undefined && typeof b.published !== "boolean") {
    errors.push("Published must be true or false");
  }

  let sourceName = null;
  let sourcePage = null;
  if (b.sourceName !== undefined && b.sourceName !== null && b.sourceName !== "") {
    if (typeof b.sourceName !== "string" || b.sourceName.trim().length > 150) {
      errors.push("Source name must be at most 150 characters");
    } else {
      sourceName = b.sourceName.trim();
    }
  }
  if (b.sourcePage !== undefined && b.sourcePage !== null && b.sourcePage !== "") {
    const page = Number(b.sourcePage);
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      errors.push("Source page must be a whole number of at least 1");
    } else {
      sourcePage = page;
    }
  }
  if (sourcePage !== null && !sourceName) {
    errors.push("A source page needs a source name");
  }

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      question,
      answer,
      intent,
      order,
      published: b.published === true,
      sourceName,
      sourcePage,
    },
  };
}

function toApi(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    question: d.question,
    answer: d.answer,
    category: d.intent || "general",
    order: d.order ?? 100,
    published: d.published === true,
    sourceName: d.sourceName || null,
    sourcePage: d.sourcePage || null,
    createdAt: d.createdAt?.toDate?.().toISOString() ?? null,
    updatedAt: d.updatedAt?.toDate?.().toISOString() ?? null,
    updatedBy: d.updatedBy || null,
  };
}

/** GET /admin/faq - every entry, drafts included */
router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("faqs").limit(MAX_FAQS).get();
    const faqs = snap.docs.map(toApi);
    faqs.sort(
      (a, b) =>
        a.order - b.order || String(a.createdAt).localeCompare(String(b.createdAt))
    );
    res.json({ faqs });
  } catch (error) {
    failInternal(res, error, "Failed to load FAQs");
  }
});

/** POST /admin/faq */
router.post("/", async (req, res) => {
  try {
    const { errors, value } = parseFaq(req.body);
    if (errors.length) return res.status(400).json({ error: "Invalid FAQ", errors });

    const existing = await db.collection("faqs").count().get();
    if (existing.data().count >= MAX_FAQS) {
      return res.status(400).json({ error: `At most ${MAX_FAQS} FAQs are allowed` });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection("faqs").add({
      ...value,
      createdAt: now,
      updatedAt: now,
      createdBy: req.email || req.uid,
      updatedBy: req.email || req.uid,
    });
    res.status(201).json({ success: true, id: ref.id });
  } catch (error) {
    failInternal(res, error, "Failed to create FAQ");
  }
});

/** PUT /admin/faq/:id */
router.put("/:id", async (req, res) => {
  try {
    const ref = db.collection("faqs").doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: "FAQ not found" });

    const { errors, value } = parseFaq(req.body);
    if (errors.length) return res.status(400).json({ error: "Invalid FAQ", errors });

    await ref.update({
      ...value,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.email || req.uid,
    });
    res.json({ success: true });
  } catch (error) {
    failInternal(res, error, "Failed to update FAQ");
  }
});

/** DELETE /admin/faq/:id */
router.delete("/:id", async (req, res) => {
  try {
    const ref = db.collection("faqs").doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: "FAQ not found" });
    await ref.delete();
    res.json({ success: true });
  } catch (error) {
    failInternal(res, error, "Failed to delete FAQ");
  }
});

export default router;
