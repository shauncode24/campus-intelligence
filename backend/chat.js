import { detectIntent } from "./intent.js";
import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import {
  generateDefinitionAnswer,
  generateProcedureAnswer,
  generateSemanticAnswer,
  generateEnhancedAnswer,
  enhanceAnswerWithDeadline,
} from "./answer.js";
import {
  findSimilarQuestion,
  storeQuestion,
  incrementQuestionCount,
  storeUserQuestion,
} from "./questionCache.js";
import { retrieveMultiModalChunks } from "./multiModalRetrieval.js";

/**
 * Detect if query is asking for specific data from tables/forms
 */
function isSpecificDataQuery(question) {
  const specificPatterns = [
    /what is .+ (ip address|subnet mask|gateway|address|mask|value|number)/i,
    /what's .+ (ip address|subnet mask|gateway|address|mask|value|number)/i,
    /tell me .+ (ip address|subnet mask|gateway|address|mask|value|number)/i,
    /show me .+ (ip address|subnet mask|gateway|address|mask|value|number)/i,
    /(ip address|subnet mask|gateway|address|mask) (of|for) .+/i,
  ];

  return specificPatterns.some((pattern) => pattern.test(question));
}

export async function handleChat(question, userId = "anonymous") {
  try {
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);

    // Detect if this is a specific data query
    const isSpecificQuery = isSpecificDataQuery(question);
    if (isSpecificQuery) {
      console.log(
        `🔍 Detected specific data query - will prioritize visual content`
      );
    }

    const embedding = await getEmbedding(question);
    console.log(`🔢 Generated question embedding`);

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

    console.log(`🤖 Generating new answer via multi-modal RAG`);

    // IMPROVED: More chunks for specific queries
    let chunkCount = 5;
    if (isSpecificQuery)
      chunkCount = 7; // More chunks to ensure we find the data
    else if (intent === "definition") chunkCount = 5; // Increased from 3
    else if (intent === "procedure") chunkCount = 5;
    else if (intent === "deadline") chunkCount = 3;
    else if (intent === "requirement") chunkCount = 4;

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

    // Boost visual chunks if it's a specific query
    let processedChunks = chunks;
    if (isSpecificQuery) {
      processedChunks = chunks.sort((a, b) => {
        const aBoost = a.type === "visual" ? 0.2 : 0;
        const bBoost = b.type === "visual" ? 0.2 : 0;
        return b.score + bBoost - (a.score + aBoost);
      });
      console.log(`🚀 Boosted visual chunks for specific query`);
    }

    console.log(
      `📚 Retrieved ${processedChunks.length} chunks (${
        processedChunks.filter((c) => c.type === "visual").length
      } visual)`
    );

    const hasVisualContent = processedChunks.some((c) => c.type === "visual");
    if (hasVisualContent) {
      console.log(`🎨 Visual content detected - enhanced answer generation`);
    }

    // IMPROVED: Use generateEnhancedAnswer for all types when visual content exists
    let result;
    if (hasVisualContent || isSpecificQuery) {
      result = await generateEnhancedAnswer(question, processedChunks);
    } else if (intent === "definition") {
      result = await generateDefinitionAnswer(question, processedChunks);
    } else if (intent === "procedure") {
      result = await generateProcedureAnswer(question, processedChunks);
    } else {
      result = await generateSemanticAnswer(question, processedChunks);
    }

    const { answer, confidence, sources } = result;

    const enhancedResult = enhanceAnswerWithDeadline(answer, intent, sources);

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
    throw error;
  }
}
