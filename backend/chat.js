import { detectIntent } from "./intent.js";
import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import {
  generateDefinitionAnswer,
  generateProcedureAnswer,
  generateDeadlineAnswer,
  generateSemanticAnswer,
} from "./answer.js";
import {
  findSimilarQuestion,
  storeQuestion,
  incrementQuestionCount,
  storeUserQuestion,
} from "./questionCache.js";

export async function handleChat(question, userId = "anonymous") {
  try {
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);

    // Get embedding for the question
    const embedding = await getEmbedding(question);
    console.log(`📢 Generated question embedding`);

    // 🆕 PHASE 5.5: Check question cache first
    const cachedQuestion = await findSimilarQuestion(embedding, intent);

    if (cachedQuestion) {
      console.log(`♻️ Reusing cached answer`);

      // Increment count for this question
      await incrementQuestionCount(cachedQuestion.id);

      // Store in user history
      await storeUserQuestion(userId, cachedQuestion.id, question);

      return {
        answer: cachedQuestion.answer,
        cached: true,
        similarity: cachedQuestion.similarity,
        // Include confidence and sources from cache if available
        confidence: cachedQuestion.confidence || null,
        sources: cachedQuestion.sources || [],
      };
    }

    // No cache hit - proceed with normal RAG flow
    console.log(`🤖 Generating new answer via RAG`);

    let result;
    let chunks;

    // 📚 Definition questions - top 3 chunks
    if (intent === "definition") {
      chunks = await retrieveSemanticChunks(embedding, 3);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "Not explicitly defined in the document.",
          cached: false,
          confidence: {
            level: "Low",
            score: 0,
            reasoning: "No relevant sources found",
          },
          sources: [],
        };
      }

      console.log(
        `📚 Retrieved ${chunks.length} chunks for definition question`
      );
      result = await generateDefinitionAnswer(question, chunks);
    }

    // 🧭 Procedure questions - top 5 chunks
    else if (intent === "procedure") {
      chunks = await retrieveSemanticChunks(embedding, 5);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "No relevant information found in the documents.",
          cached: false,
          confidence: {
            level: "Low",
            score: 0,
            reasoning: "No relevant sources found",
          },
          sources: [],
        };
      }

      console.log(
        `📋 Retrieved ${chunks.length} chunks for procedure question`
      );
      result = await generateProcedureAnswer(question, chunks);
    }

    // 📅 Deadline questions - top 3 chunks
    else if (intent === "deadline") {
      chunks = await retrieveSemanticChunks(embedding, 3);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "No deadline information found in the documents.",
          cached: false,
          confidence: {
            level: "Low",
            score: 0,
            reasoning: "No relevant sources found",
          },
          sources: [],
        };
      }

      console.log(`⏰ Retrieved ${chunks.length} chunks for deadline question`);
      result = await generateSemanticAnswer(question, chunks);
    }

    // ✅ Requirement questions - top 4 chunks
    else if (intent === "requirement") {
      chunks = await retrieveSemanticChunks(embedding, 4);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "No requirement information found in the documents.",
          cached: false,
          confidence: {
            level: "Low",
            score: 0,
            reasoning: "No relevant sources found",
          },
          sources: [],
        };
      }

      console.log(
        `📝 Retrieved ${chunks.length} chunks for requirement question`
      );
      result = await generateSemanticAnswer(question, chunks);
    }

    // 📖 General semantic questions - top 5 chunks
    else {
      chunks = await retrieveSemanticChunks(embedding, 5);

      console.log(`📚 Retrieved ${chunks.length} chunks for general question`);
      console.log(
        `📊 Chunk scores: ${chunks.map((c) => c.score.toFixed(3)).join(", ")}`
      );

      result = await generateSemanticAnswer(question, chunks);
    }

    // Extract answer from result (could be string or object)
    const answer = typeof result === "string" ? result : result.answer;
    const confidence = typeof result === "object" ? result.confidence : null;
    const sources = typeof result === "object" ? result.sources : [];

    // 🆕 Store the new question and answer in cache with confidence and sources
    const questionId = await storeQuestion(
      question,
      embedding,
      answer,
      intent,
      confidence,
      sources
    );

    // Store in user history
    await storeUserQuestion(userId, questionId, question);

    console.log(`✅ Answer generated and cached with confidence and sources`);

    return {
      answer,
      cached: false,
      confidence,
      sources,
    };
  } catch (error) {
    console.error("❌ Error in handleChat:", error);
    throw error;
  }
}
