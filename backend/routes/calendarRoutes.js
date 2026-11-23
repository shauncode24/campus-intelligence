import express from "express";
import crypto from "crypto";
import {
  getAuthUrl,
  getTokensFromCode,
  createCalendarEvent,
  isValidFutureDate,
} from "../services/calendarService.js";
import { db } from "../config/firebaseAdmin.js";
import admin from "firebase-admin";
import dotenv from "dotenv";
import { requireAuth } from "../middleware/auth.js";

dotenv.config();

const router = express.Router();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

// OAuth `state` is a random single-use nonce stored server-side and bound to the
// authenticated uid. It is NOT the user id, so an attacker cannot forge it to
// attach their Google account to someone else's uid.
const STATE_COLLECTION = "calendar_oauth_states";
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_PATTERN = /^[a-f0-9]{48}$/;

/**
 * Step 1: Initiate OAuth flow
 * GET /calendar/auth   (requires Firebase ID token)
 */
router.get("/auth", requireAuth, async (req, res) => {
  try {
    const nonce = crypto.randomBytes(24).toString("hex");

    await db
      .collection(STATE_COLLECTION)
      .doc(nonce)
      .set({
        uid: req.uid,
        expiresAt: Date.now() + STATE_TTL_MS,
      });

    res.json({ authUrl: getAuthUrl(nonce) });
  } catch (error) {
    console.error("Auth URL generation error:", error);
    res.status(500).json({ error: "Failed to generate auth URL" });
  }
});

/**
 * Atomically consume a state nonce. Returns the uid it was issued to, or null
 * if it is unknown, already used, or expired.
 */
async function consumeState(state) {
  if (typeof state !== "string" || !STATE_PATTERN.test(state)) return null;

  const ref = db.collection(STATE_COLLECTION).doc(state);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    t.delete(ref); // single use, even if expired
    const { uid, expiresAt } = snap.data();
    return expiresAt > Date.now() ? uid : null;
  });
}

/**
 * Step 2: OAuth callback (browser redirect from Google; no bearer token here,
 * identity is established by the server-issued `state` nonce)
 * GET /calendar/callback
 */
router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send("Authorization code missing");
    }

    const uid = await consumeState(state);
    if (!uid) {
      console.warn("OAuth callback rejected: invalid, used or expired state");
      return res.redirect(`${frontendUrl}/calendar/error`);
    }

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code);

    // Store tokens in Firestore (still plaintext: encryption is tracked as P2-9)
    await db.collection("user_calendar_tokens").doc(uid).set({
      tokens,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Redirect to frontend with success
    res.redirect(`${frontendUrl}/calendar/success`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.redirect(`${frontendUrl}/calendar/error`);
  }
});

/**
 * Step 3: Create calendar event
 * POST /calendar/create-event   (requires Firebase ID token)
 */
router.post("/create-event", requireAuth, async (req, res) => {
  try {
    const { eventData } = req.body;
    const userId = req.uid;

    if (!eventData) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { title, date, description, sourceDocument } = eventData;

    // Validate date
    if (!isValidFutureDate(date)) {
      return res.status(400).json({
        error: "Invalid or past date",
        message: "The deadline has already passed or date format is invalid",
      });
    }

    // Get the authenticated user's tokens
    const tokenDoc = await db
      .collection("user_calendar_tokens")
      .doc(userId)
      .get();

    if (!tokenDoc.exists) {
      return res.status(401).json({
        error: "Not authorized",
        message: "Please connect your Google Calendar first",
      });
    }

    const { tokens } = tokenDoc.data();

    // Create event
    const event = await createCalendarEvent(tokens, eventData);

    // Store event record for history
    await db.collection("calendar_events").add({
      userId,
      eventId: event.id,
      title,
      date,
      sourceDocument,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      event: {
        id: event.id,
        title: event.summary,
        link: event.htmlLink,
      },
    });
  } catch (error) {
    console.error("Create event error:", error);

    if (error.message.includes("invalid_grant")) {
      return res.status(401).json({
        error: "Token expired",
        message: "Please reconnect your Google Calendar",
      });
    }

    res.status(500).json({
      error: "Failed to create event",
      message: error.message,
    });
  }
});

/**
 * Check if the authenticated user has connected a calendar
 * GET /calendar/status   (requires Firebase ID token)
 */
router.get("/status", requireAuth, async (req, res) => {
  try {
    const tokenDoc = await db
      .collection("user_calendar_tokens")
      .doc(req.uid)
      .get();

    res.json({
      connected: tokenDoc.exists,
      connectedAt: tokenDoc.exists ? tokenDoc.data().createdAt : null,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: "Failed to check status" });
  }
});

/**
 * Disconnect the authenticated user's calendar
 * DELETE /calendar/disconnect   (requires Firebase ID token)
 */
router.delete("/disconnect", requireAuth, async (req, res) => {
  try {
    await db.collection("user_calendar_tokens").doc(req.uid).delete();

    res.json({ success: true, message: "Calendar disconnected" });
  } catch (error) {
    console.error("Disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

export default router;
