import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { handleChatStream } from "./chatStream.js";
import { handleChat } from "./chat.js";
import { getFAQ, getUserHistory } from "./questionCache.js";
import calendarRoutes from "./calendarRoutes.js";
import documentRoutes from "./documentRoutes.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: ["https://your-frontend.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.options("*", cors());

res.cookie("token", value, {
  httpOnly: true,
  secure: true,
  sameSite: "none",
});

// Original non-streaming endpoint (keep for backward compatibility)
app.post("/ask", async (req, res) => {
  try {
    const { question, userId } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question required" });
    }

    const effectiveUserId =
      userId || req.headers["x-session-id"] || "anonymous";

    const result = await handleChat(question, effectiveUserId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Streaming endpoint
app.post("/ask-stream", async (req, res) => {
  try {
    const { question, userId } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question required" });
    }

    const effectiveUserId =
      userId || req.headers["x-session-id"] || "anonymous";

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Handle streaming - pass res so we can write to it
    await handleChatStream(question, effectiveUserId, res);

    // End the response
    res.end();
  } catch (err) {
    console.error("Streaming error:", err);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: err.message,
      })}\n\n`
    );
    res.end();
  }
});

// Get FAQ endpoint
app.get("/faq", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const faqs = await getFAQ(limit);
    res.json({ faqs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get user history endpoint
app.get("/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    const history = await getUserHistory(userId, limit);
    res.json({ history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Calendar routes
app.use("/calendar", calendarRoutes);

// Document processing routes
app.use("/documents", documentRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("🚀 RAG backend running on ${VITE_API_BASE_URL}");
  console.log("\n📋 Available endpoints:");
  console.log("  POST   /ask                        - Ask a question");
  console.log("  POST   /ask-stream                 - Ask with streaming");
  console.log("  GET    /faq                        - Get FAQs");
  console.log("  GET    /history/:userId            - Get user history");
  console.log("  GET    /calendar/auth              - Google Calendar OAuth");
  console.log("  GET    /calendar/callback          - OAuth callback");
  console.log("  POST   /calendar/create-event      - Create calendar event");
  console.log("  GET    /calendar/status            - Check calendar status");
  console.log("  DELETE /calendar/disconnect        - Disconnect calendar");
  console.log("  POST   /documents/process          - Process new document");
  console.log(
    "  POST   /documents/reprocess        - Reprocess existing document"
  );
  console.log("\n✅ Server ready!");
});
