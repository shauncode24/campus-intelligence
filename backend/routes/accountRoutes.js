import express from "express";
import admin from "firebase-admin";
import { db } from "../config/firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { accountUserLimiter } from "../middleware/rateLimit.js";
import { failInternal } from "../utils/httpErrors.js";
import { deleteUserData } from "../services/userData.js";
import { revokeTokens } from "../services/calendarService.js";
import { loadTokens } from "../services/calendarTokens.js";

const router = express.Router();

/**
 * DELETE /me   (requires Firebase ID token; body {"confirm": true})
 *
 * Erases everything stored about the signed-in person (chats, history, notes, feedback,
 * calendar link) and then their sign-in account itself. Order matters: the data goes first, so
 * a failure leaves an account that can simply try again; the account goes last.
 * Administrator accounts are refused (remove the admin claim first).
 */
router.delete("/", requireAuth, accountUserLimiter, async (req, res) => {
  try {
    if (!req.body || req.body.confirm !== true) {
      return res.status(400).json({ error: "Confirmation required", message: 'Send {"confirm": true} to delete your data' });
    }
    if (req.claims && req.claims.admin === true) {
      return res.status(403).json({
        error: "Administrator account",
        message: "Administrator accounts cannot be deleted here. Remove the admin role first.",
      });
    }

    // Best effort: tell Google the calendar link is no longer wanted
    try {
      const tokens = await loadTokens(db, admin, req.uid);
      if (tokens) await revokeTokens(tokens);
    } catch (e) {
      console.warn("Could not revoke the calendar token at Google:", e.name);
    }

    const removed = await deleteUserData(db, req.uid);

    try {
      await admin.auth().deleteUser(req.uid);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    res.json({ success: true, removed });
  } catch (error) {
    console.error("Account deletion failed:", error);
    failInternal(res, error, "Could not delete your data. Please try again.");
  }
});

export default router;
