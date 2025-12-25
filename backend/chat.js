import { detectIntent } from "./intent.js";
import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import {
  generateDefinitionAnswerStream,
  generateProcedureAnswerStream,
  generateSemanticAnswerStream,
} from "./answer.js";
import {
  findSimilarQuestion,
  storeQuestion,
  incrementQuestionCount,
  storeUserQuestion,
} from "./questionCache.js";
import { enhanceAnswerWithDeadline } from "./answer.js";

// Original non-streaming function (keep as is)
export async function handleChat(question, userId = "anonymous") {
  // ... keep existing implementation exactly as is
}

// NEW: Streaming version
export async function handleChatStream(question, userId, res) {
  try {
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);

    // Send intent info
    res.write(`data: ${JSON.stringify({ type: "intent", data: intent })}\n\n`);

    // Get embedding
    const embedding = await getEmbedding(question);
    console.log(`🔢 Generated question embedding`);

    // Check cache
    const cachedQuestion = await findSimilarQuestion(embedding, intent);

    if (cachedQuestion) {
      console.log(`♻️ Reusing cached answer`);

      // Send metadata
      res.write(
        `data: ${JSON.stringify({
          type: "metadata",
          data: {
            cached: true,
            similarity: cachedQuestion.similarity,
            confidence: cachedQuestion.confidence,
            sources: cachedQuestion.sources,
            deadline: cachedQuestion.deadline,
          },
        })}\n\n`
      );

      // Stream cached answer word by word
      const words = cachedQuestion.answer.split(" ");
      for (let i = 0; i < words.length; i++) {
        const chunk = i === words.length - 1 ? words[i] : words[i] + " ";
        res.write(`data: ${JSON.stringify({ type: "text", data: chunk })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 30)); // 30ms delay between words
      }

      // Increment cache count
      await incrementQuestionCount(cachedQuestion.id);
      await storeUserQuestion(userId, cachedQuestion.id, question);

      // Send completion
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    // No cache hit - generate new answer with streaming
    console.log(`🤖 Generating new answer via RAG with streaming`);

    let chunks;
    let chunkCount = 5;

    // Get appropriate number of chunks based on intent
    if (intent === "definition") {
      chunkCount = 3;
    } else if (intent === "procedure") {
      chunkCount = 5;
    } else if (intent === "deadline") {
      chunkCount = 3;
    } else if (intent === "requirement") {
      chunkCount = 4;
    }

    chunks = await retrieveSemanticChunks(embedding, chunkCount);

    if (!chunks || chunks.length === 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "text",
          data: "No relevant information found in the documents.",
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    console.log(`📚 Retrieved ${chunks.length} chunks`);

    // Generate answer with streaming
    let fullAnswer = "";
    let confidence = null;
    let sources = [];

    // Choose appropriate generator based on intent
    if (intent === "definition") {
      const result = await generateDefinitionAnswerStream(
        question,
        chunks,
        res
      );
      fullAnswer = result.answer;
      confidence = result.confidence;
      sources = result.sources;
    } else if (intent === "procedure") {
      const result = await generateProcedureAnswerStream(question, chunks, res);
      fullAnswer = result.answer;
      confidence = result.confidence;
      sources = result.sources;
    } else {
      const result = await generateSemanticAnswerStream(question, chunks, res);
      fullAnswer = result.answer;
      confidence = result.confidence;
      sources = result.sources;
    }

    // Extract deadline
    const enhancedResult = enhanceAnswerWithDeadline(
      fullAnswer,
      intent,
      sources
    );

    // Send metadata after text is done
    res.write(
      `data: ${JSON.stringify({
        type: "metadata",
        data: {
          cached: false,
          confidence,
          sources,
          deadline: enhancedResult.deadline,
        },
      })}\n\n`
    );

    // Store in cache
    const questionId = await storeQuestion(
      question,
      embedding,
      fullAnswer,
      intent,
      confidence,
      sources,
      enhancedResult.deadline
    );

    await storeUserQuestion(userId, questionId, question);

    // Send completion
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    console.error("❌ Error in handleChatStream:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: "Sorry, I encountered an error. Please try again.",
      })}\n\n`
    );
    res.end();
  }
}
