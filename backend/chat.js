import { detectIntent } from "./intent.js";
import {
  findSimilarQuestion,
  storeQuestion,
  incrementQuestionCount,
  storeUserQuestion,
} from "./questionCache.js";
import { enhanceAnswerWithDeadline } from "./answer.js";
import fetch from "node-fetch";

const PYTHON_RAG_URL = process.env.PYTHON_RAG_URL || "http://localhost:8000";

/**
 * Call Python RAG service
 */
async function queryPythonRAG(question) {
  try {
    const response = await fetch(`${PYTHON_RAG_URL}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: question,
        documentIds: null, // Query all documents
      }),
    });

    if (!response.ok) {
      throw new Error(`Python RAG service error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("❌ Error calling Python RAG service:", error);
    throw error;
  }
}

/**
 * Generate a simple embedding for cache lookup (using question text)
 * Since we're using CLIP in Python, we'll create a simple hash-based embedding
 */
function createSimpleEmbedding(text) {
  // Simple character-based embedding for cache lookup
  const embedding = new Array(512).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    embedding[i % 512] += charCode;
  }
  // Normalize
  const magnitude = Math.sqrt(
    embedding.reduce((sum, val) => sum + val * val, 0)
  );
  return embedding.map((val) => val / magnitude);
}

export async function handleChat(question, userId = "anonymous") {
  try {
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);

    // Create embedding for cache lookup
    const embedding = createSimpleEmbedding(question);
    console.log(`🔢 Generated question embedding for cache`);

    // Check cache first
    const cachedQuestion = await findSimilarQuestion(embedding, intent);

    if (cachedQuestion) {
      console.log(
        `♻️ Reusing cached answer (similarity: ${cachedQuestion.similarity.toFixed(
          3
        )})`
      );

      await incrementQuestionCount(cachedQuestion.id);
      await storeUserQuestion(userId, cachedQuestion.id, question);

      return {
        answer: cachedQuestion.answer,
        cached: true,
        similarity: cachedQuestion.similarity,
        confidence: cachedQuestion.confidence,
        sources: cachedQuestion.sources,
        deadline: cachedQuestion.deadline,
      };
    }

    console.log(`🤖 Generating new answer via Python RAG service`);

    // Call Python RAG service
    const result = await queryPythonRAG(question);

    const { answer, sources, hasVisualContent } = result;

    // Create confidence based on sources
    const confidence = {
      level:
        sources.length >= 3 ? "High" : sources.length >= 2 ? "Medium" : "Low",
      score: Math.min(90, sources.length * 30),
      reasoning: `Found ${sources.length} relevant sources`,
    };

    // Extract deadline if present
    const enhancedResult = enhanceAnswerWithDeadline(answer, intent, sources);

    // Store in cache
    const questionId = await storeQuestion(
      question,
      embedding,
      answer,
      intent,
      confidence,
      sources,
      enhancedResult.deadline
    );

    await storeUserQuestion(userId, questionId, question);

    return {
      answer: enhancedResult.answer,
      cached: false,
      confidence,
      sources,
      deadline: enhancedResult.deadline,
      hasVisualContent,
    };
  } catch (error) {
    console.error("❌ Error in handleChat:", error);

    // Fallback error response
    return {
      answer:
        "I'm having trouble processing your question right now. Please try again in a moment.",
      cached: false,
      confidence: { level: "Low", score: 0, reasoning: "Error occurred" },
      sources: [],
      deadline: null,
    };
  }
}
