import express from "express";
import {
  getAuthUrl,
  getTokensFromCode,
  createCalendarEvent,
  isValidFutureDate,
} from "./calendarService.js";
import { db } from "./firebaseAdmin.js";
import admin from "firebase-admin";

const router = express.Router();

/**
 * Step 1: Initiate OAuth flow
 * GET /calendar/auth
 */
router.get("/auth", (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Generate auth URL
    const authUrl = getAuthUrl();

    // Store userId in session (you could also use state parameter)
    // For now, we'll include it in the redirect
    const urlWithState = `${authUrl}&state=${userId}`;

    res.json({ authUrl: urlWithState });
  } catch (error) {
    console.error("Auth URL generation error:", error);
    res.status(500).json({ error: "Failed to generate auth URL" });
  }
});

/**
 * Step 2: OAuth callback
 * GET /calendar/callback
 */
router.get("/callback", async (req, res) => {
  try {
    const { code, state: userId } = req.query;

    if (!code) {
      return res.status(400).send("Authorization code missing");
    }

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code);

    // Store tokens in Firestore (encrypted in production!)
    if (userId) {
      await db.collection("user_calendar_tokens").doc(userId).set({
        tokens,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Redirect to frontend with success
    res.redirect("http://localhost:5173/calendar/success");
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.redirect("http://localhost:5173/calendar/error");
  }
});

/**
 * Step 3: Create calendar event
 * POST /calendar/create-event
 */
router.post("/create-event", async (req, res) => {
  try {
    const { userId, eventData } = req.body;

    if (!userId || !eventData) {
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

    // Get user's tokens
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
 * Check if user has connected calendar
 * GET /calendar/status
 */
router.get("/status", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const tokenDoc = await db
      .collection("user_calendar_tokens")
      .doc(userId)
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
 * Disconnect calendar
 * DELETE /calendar/disconnect
 */
router.delete("/disconnect", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    await db.collection("user_calendar_tokens").doc(userId).delete();

    res.json({ success: true, message: "Calendar disconnected" });
  } catch (error) {
    console.error("Disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

export default router;
