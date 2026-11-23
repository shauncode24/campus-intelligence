import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { getUserHistory } from "./services/questionCache.js";
import calendarRoutes from "./routes/calendarRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import faqAdminRoutes from "./routes/faqAdminRoutes.js";
import { requireAuth } from "./middleware/auth.js";
import { ipLimiter, queryIpLimiter, queryUserLimiter } from "./middleware/rateLimit.js";
import { failInternal, logError } from "./utils/httpErrors.js";

dotenv.config();

const app = express();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const pythonRagUrl = process.env.PYTHON_RAG_URL || "http://localhost:8000";

// Only the web app's own origin(s) may call this API from a browser. (The
// Python service is called server-to-server, so it needs no CORS entry.) The
// API uses bearer tokens, not cookies, so credentials are not allowed.
const extraOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: [frontendUrl, ...extraOrigins],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

// Behind a reverse proxy the client IP is in X-Forwarded-For. Set
// TRUST_PROXY=1 only when a trusted proxy sets it (otherwise it can be
// spoofed); without it every user behind the proxy shares one IP bucket.
app.set(
  "trust proxy",
  ["1", "true", "yes"].includes((process.env.TRUST_PROXY || "").toLowerCase()) ? 1 : false
);

app.use(ipLimiter);
app.use(express.json({ limit: "100kb" }));

const MAX_QUESTION_CHARS = Number.parseInt(process.env.MAX_QUESTION_CHARS ?? "", 10) || 2000;

app.post(
  "/document/query",
  requireAuth,
  queryIpLimiter,
  queryUserLimiter,
  async (req, res) => {
  try {
    // Identity comes from the verified token only (req.uid); a userId in the
    // body is ignored.
    const { question } = req.body;

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Question required" });
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return res
        .status(400)
        .json({ error: `Question is too long (max ${MAX_QUESTION_CHARS} characters)` });
    }

    const effectiveUserId = req.uid;

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    console.log(`🔍 Querying Python RAG service: ${question}`);
    console.log(`👤 User: ${effectiveUserId}`);
    console.log(`🔗 Python RAG URL: ${pythonRagUrl}`);

    // Build request body (no user id: Python derives it from the token)
    const requestBody = {
      question: question,
    };

    // Call Python RAG service, forwarding the caller's token so Python
    // verifies identity itself.
    const pythonResponse = await fetch(`${pythonRagUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.authToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`📡 Python response status: ${pythonResponse.status}`);

    // The RAG service enforces the per-user daily question budget. Its message
    // is written for users, so pass it on instead of a generic failure.
    if (pythonResponse.status === 429) {
      const body = await pythonResponse.json().catch(() => ({}));
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          userFacing: true,
          data: body.detail || "Too many requests. Please try again later.",
        })}\n\n`
      );
      return res.end();
    }

    if (!pythonResponse.ok) {
      const errorText = await pythonResponse.text();
      console.error(`❌ Python RAG error (${pythonResponse.status}): ${errorText}`);
      throw new Error(`Python RAG error: ${pythonResponse.statusText}`);
    }

    const result = await pythonResponse.json();
    console.log(`✅ Got result from Python RAG:`, {
      answerLength: result.answer?.length,
      sourcesCount: result.sources?.length,
      hasVisualContent: result.hasVisualContent,
      cached: result.cached,
    });

    // Send intent
    res.write(
      `data: ${JSON.stringify({
        type: "intent",
        data: "general",
      })}\n\n`
    );

    // Stream the answer word by word for smooth effect
    const words = result.answer.split(" ");
    for (const word of words) {
      res.write(
        `data: ${JSON.stringify({
          type: "text",
          data: word + " ",
        })}\n\n`
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    // Send metadata
    res.write(
      `data: ${JSON.stringify({
        type: "metadata",
        data: {
          cached: result.cached || false,
          answered: result.answered !== false,
          similarity: result.similarity,
          // No confidence value is sent: the previous number was derived from
          // the count of retrieved chunks (always the same), so it said nothing
          // about whether the answer was correct.
          sources: result.sources.map((s) => ({
            documentId: s.documentId,
            documentName: s.documentName || "Document",
            pageNumber: s.page, // 0-based, legacy
            displayPage: s.displayPage, // 1-based, what users should see
            type: s.type,
            excerpt: s.content,
            similarity: Math.round((s.similarity || 0) * 100),
            fileUrl: s.fileUrl, // ADD
          })),
          hasVisualContent: result.hasVisualContent,
          deadline: result.deadline, // ADD THIS
        },
      })}\n\n`
    );

    // Send done
    res.write(
      `data: ${JSON.stringify({
        type: "done",
      })}\n\n`
    );

    res.end();
  } catch (error) {
    const ref = logError(error, "document query");
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: `Something went wrong. Please try again. (ref ${ref})`,
      })}\n\n`
    );
    res.end();
  }
  }
);

// Get the authenticated user's history (uid comes from the token, not the URL)
app.get("/history", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    const history = await getUserHistory(req.uid, limit);
    res.json({ history });
  } catch (err) {
    failInternal(res, err, "Failed to load history");
  }
});

// Calendar routes
app.use("/calendar", calendarRoutes);

// Document processing routes
app.use("/documents", documentRoutes);

// Admin-curated FAQ management (the public FAQ is served by the RAG service)
app.use("/admin/faq", faqAdminRoutes);

app.use("/api/documents", documentRoutes);

// Last-resort error handler. Without it Express answers errors that escape a
// route (e.g. malformed JSON) with an HTML page containing the stack trace and
// file paths whenever NODE_ENV is not "production".
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  const ref = logError(err, "unhandled error");
  res.status(500).json({
    error: "Internal server error",
    message: `Something went wrong (ref ${ref})`,
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 RAG backend running on ${PORT}`);
  console.log("\n📋 Available endpoints:");
  console.log("  POST   /ask                        - Ask a question");
  console.log("  POST   /ask-stream                 - Ask with streaming");
  console.log(
    "  POST   /document/query             - Query Python RAG (with caching!)"
  );
  console.log("  *      /admin/faq                  - Manage curated FAQs (admin)");
  console.log("  GET    /history                    - Get user history (auth)");
  console.log("  GET    /calendar/auth              - Google Calendar OAuth");
  console.log("  GET    /calendar/callback          - OAuth callback");
  console.log("  POST   /calendar/create-event      - Create calendar event");
  console.log("  GET    /calendar/status            - Check calendar status");
  console.log("  DELETE /calendar/disconnect        - Disconnect calendar");
  console.log("  POST   /documents/process          - Process new document");
  console.log(
    "  POST   /documents/reprocess        - Reprocess existing document"
  );
  console.log("\n🐍 Python RAG endpoints:");
  console.log(
    "  POST   http://localhost:8000/query          - Query with caching"
  );
  console.log(
    "  POST   http://localhost:8000/process-document - Process document"
  );
  console.log("  GET    http://localhost:8000/faq            - Public curated FAQ");
  console.log(
    "  GET    http://localhost:8000/history/{userId} - Get history from Python"
  );
  console.log(
    "  GET    http://localhost:8000/health         - Python service health"
  );
  console.log("\n✅ Server ready!");
  console.log(`🔗 Python RAG URL: ${pythonRagUrl || "NOT SET"}`);
});
