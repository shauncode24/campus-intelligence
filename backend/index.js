import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { getFAQ, getUserHistory } from "./questionCache.js";
import calendarRoutes from "./calendarRoutes.js";
import documentRoutes from "./documentRoutes.js";

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

app.post("/document/query", async (req, res) => {
  try {
    const { question, userId } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question required" });
    }

    const effectiveUserId = userId || "anonymous";

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    console.log(`🔍 Querying Python RAG service: ${question}`);
    console.log(`👤 User: ${effectiveUserId}`);
    console.log(`🔗 Python RAG URL: ${pythonRagUrl}`);

    // Build request body
    const requestBody = {
      question: question,
      userId: effectiveUserId, // ✅ Pass userId to Python
    };

    // Call Python RAG service with proper error handling
    const pythonResponse = await fetch(`${pythonRagUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
          confidence: {
            level:
              result.sources.length >= 3
                ? "High"
                : result.sources.length >= 2
                ? "Medium"
                : "Low",
            score: Math.min(90, result.sources.length * 30),
            reasoning: `Found ${result.sources.length} relevant sources`,
          },
          sources: result.sources.map((s) => ({
            documentId: s.documentId,
            documentName: "Document",
            pageNumber: s.page,
            type: s.type,
            excerpt: s.content,
            similarity: 85,
          })),
          hasVisualContent: result.hasVisualContent,
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
  console.log(`🚀 RAG backend running on ${PORT}`);
  console.log("\n📋 Available endpoints:");
  console.log("  POST   /ask                        - Ask a question");
  console.log("  POST   /ask-stream                 - Ask with streaming");
  console.log(
    "  POST   /document/query             - Query Python RAG (with caching!)"
  );
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
