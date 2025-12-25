import { detectIntent } from "./intent.js";
import { getEmbedding } from "./embedding.js";
import {
  generateDefinitionAnswerStream,
  generateProcedureAnswerStream,
  generateSemanticAnswerStream,
  enhanceAnswerWithDeadline,
} from "./answer.js";
import {
  findSimilarQuestion,
  storeQuestion,
  incrementQuestionCount,
  storeUserQuestion,
} from "./questionCache.js";
import { retrieveMultiModalChunks } from "./multiModalRetrieval.js";

export async function handleChatStream(question, userId, res) {
  try {
    // Send intent detection event
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);
    res.write(
      `data: ${JSON.stringify({
        type: "intent",
        data: intent,
      })}\n\n`
    );

    // Get embedding
    const embedding = await getEmbedding(question);
    console.log(`🔢 Generated question embedding`);

    // Check cache first
    const cachedQuestion = await findSimilarQuestion(embedding, intent);

    if (cachedQuestion) {
      console.log(
        `♻️ Reusing cached answer (similarity: ${cachedQuestion.similarity.toFixed(
          3
        )})`
      );

      // Stream cached response word by word for smooth effect
      const words = cachedQuestion.answer.split(" ");
      for (const word of words) {
        res.write(
          `data: ${JSON.stringify({
            type: "text",
            data: word + " ",
          })}\n\n`
        );
        await sleep(30); // Small delay between words
      }

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

      // Increment count and store user question
      await incrementQuestionCount(cachedQuestion.id);
      await storeUserQuestion(userId, cachedQuestion.id, question);

      // Send done event
      res.write(
        `data: ${JSON.stringify({
          type: "done",
        })}\n\n`
      );

      return;
    }

    // No cache hit - generate new answer with streaming
    console.log(`🤖 Generating new answer via multi-modal RAG`);

    // Determine chunk count based on intent
    let chunkCount = 5;
    if (intent === "definition") chunkCount = 3;
    else if (intent === "procedure") chunkCount = 5;
    else if (intent === "deadline") chunkCount = 3;
    else if (intent === "requirement") chunkCount = 4;

    // Retrieve chunks
    const chunks = await retrieveMultiModalChunks(embedding, chunkCount);

    if (!chunks || chunks.length === 0) {
      const errorMsg =
        "I couldn't find any relevant information in the documents. Please try rephrasing your question.";

      // Stream error message
      for (const char of errorMsg) {
        res.write(
          `data: ${JSON.stringify({
            type: "text",
            data: char,
          })}\n\n`
        );
        await sleep(20);
      }

      res.write(
        `data: ${JSON.stringify({
          type: "metadata",
          data: {
            cached: false,
            confidence: null,
            sources: [],
            deadline: null,
          },
        })}\n\n`
      );

      res.write(
        `data: ${JSON.stringify({
          type: "done",
        })}\n\n`
      );

      return;
    }

    console.log(
      `📚 Retrieved ${chunks.length} chunks (${
        chunks.filter((c) => c.type === "visual").length
      } visual)`
    );

    const hasVisualContent = chunks.some((c) => c.type === "visual");
    if (hasVisualContent) {
      console.log(`🎨 Visual content detected - enhanced answer generation`);
    }

    // Generate answer with streaming based on intent
    let result;
    if (intent === "definition") {
      result = await generateDefinitionAnswerStream(question, chunks, res);
    } else if (intent === "procedure") {
      result = await generateProcedureAnswerStream(question, chunks, res);
    } else {
      result = await generateSemanticAnswerStream(question, chunks, res);
    }

    const { answer, confidence, sources } = result;

    // Extract deadline if present
    const enhancedResult = enhanceAnswerWithDeadline(answer, intent, sources);

    // Send metadata
    res.write(
      `data: ${JSON.stringify({
        type: "metadata",
        data: {
          cached: false,
          confidence,
          sources,
          deadline: enhancedResult.deadline,
          hasVisualContent,
        },
      })}\n\n`
    );

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

    // Store user question
    await storeUserQuestion(userId, questionId, question);

    // Send done event
    res.write(
      `data: ${JSON.stringify({
        type: "done",
      })}\n\n`
    );
  } catch (error) {
    console.error("❌ Error in handleChatStream:", error);

    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: error.message,
      })}\n\n`
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
