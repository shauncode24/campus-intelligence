import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { getFAQ, getUserHistory } from "./services/questionCache.js";
import calendarRoutes from "./routes/calendarRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import { requireAuth } from "./middleware/auth.js";

dotenv.config();

const app = express();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const pythonRagUrl = process.env.PYTHON_RAG_URL || "http://localhost:8000";

app.use(
  cors({
    origin: [frontendUrl, pythonRagUrl],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.set("trust proxy", 1);

app.post("/document/query", requireAuth, async (req, res) => {
  try {
    // Identity comes from the verified token only (req.uid); a userId in the
    // body is ignored.
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question required" });
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

    if (!pythonResponse.ok) {
      const errorText = await pythonResponse.text();
      console.error(`❌ Python RAG error: ${errorText}`);
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
    console.error("❌ Document query error:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: error.message,
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

// Get the authenticated user's history (uid comes from the token, not the URL)
app.get("/history", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);

    const history = await getUserHistory(req.uid, limit);
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

app.use("/api/documents", documentRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 RAG backend running on ${PORT}`);
  console.log("\n📋 Available endpoints:");
  console.log("  POST   /ask                        - Ask a question");
  console.log("  POST   /ask-stream                 - Ask with streaming");
  console.log(
    "  POST   /document/query             - Query Python RAG (with caching!)"
  );
  console.log("  GET    /faq                        - Get FAQs");
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
  console.log(
    "  GET    http://localhost:8000/faq            - Get FAQs from Python"
  );
  console.log(
    "  GET    http://localhost:8000/history/{userId} - Get history from Python"
  );
  console.log(
    "  GET    http://localhost:8000/health         - Python service health"
  );
  console.log("\n✅ Server ready!");
  console.log(`🔗 Python RAG URL: ${pythonRagUrl || "NOT SET"}`);
});
