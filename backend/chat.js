import { detectIntent } from "./intent.js";
import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import {
  generateDefinitionAnswer,
  generateProcedureAnswer,
  generateSemanticAnswer,
  enhanceAnswerWithDeadline,
} from "./answer.js";
import {
  findSimilarQuestion,
  storeQuestion,
  incrementQuestionCount,
  storeUserQuestion,
} from "./questionCache.js";
import { retrieveMultiModalChunks } from "./multiModalRetrieval.js";

export async function handleChat(question, userId = "anonymous") {
  try {
    // Detect intent
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);

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

      // Increment count and store user question
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

    // No cache hit - generate new answer
    console.log(`🤖 Generating new answer via multi-modal RAG`);

    // Determine chunk count based on intent
    let chunkCount = 5;
    if (intent === "definition") chunkCount = 3;
    else if (intent === "procedure") chunkCount = 5;
    else if (intent === "deadline") chunkCount = 3;
    else if (intent === "requirement") chunkCount = 4;

    // Use multi-modal retrieval - this gets both text AND visual chunks
    const chunks = await retrieveMultiModalChunks(embedding, chunkCount);

    if (!chunks || chunks.length === 0) {
      return {
        answer:
          "I couldn't find any relevant information in the documents. Please try rephrasing your question.",
        cached: false,
        confidence: null,
        sources: [],
        deadline: null,
      };
    }

    console.log(
      `📚 Retrieved ${chunks.length} chunks (${
        chunks.filter((c) => c.type === "visual").length
      } visual)`
    );

    // Check if we have visual content
    const hasVisualContent = chunks.some((c) => c.type === "visual");
    if (hasVisualContent) {
      console.log(`🎨 Visual content detected - enhanced answer generation`);
    }

    // Generate answer based on intent
    let result;
    if (intent === "definition") {
      result = await generateDefinitionAnswer(question, chunks);
    } else if (intent === "procedure") {
      result = await generateProcedureAnswer(question, chunks);
    } else {
      result = await generateSemanticAnswer(question, chunks);
    }

    const { answer, confidence, sources } = result;

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

    // Store user question
    await storeUserQuestion(userId, questionId, question);

    return {
      answer: enhancedResult.answer,
      cached: false,
      confidence,
      sources,
      deadline: enhancedResult.deadline,
      hasVisualContent, // Flag to indicate visual content was used
    };
  } catch (error) {
    console.error("❌ Error in handleChat:", error);
    throw error;
  }
}
