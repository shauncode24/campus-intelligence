import { detectIntent } from "./intent.js";
import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import {
  generateDefinitionAnswer,
  generateProcedureAnswer,
  generateSemanticAnswer,
} from "./answer.js";

function isDefinitionQuestion(q) {
  return /^(what is|define|what does|what are)\b/i.test(q.trim());
}

export async function handleChat(question) {
  try {
    const intent = detectIntent(question);
    console.log(`🎯 Detected intent: ${intent}`);

    // Get embedding for the question
    const embedding = await getEmbedding(question);

    // 🔒 Definition questions - top 3 chunks
    if (intent === "definition") {
      const chunks = await retrieveSemanticChunks(embedding, 3);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "Not explicitly defined in the document.",
        };
      }

      console.log(
        `📚 Retrieved ${chunks.length} chunks for definition question`
      );
      const answer = await generateDefinitionAnswer(question, chunks);
      return { answer };
    }

    // 🧭 Procedure questions - top 5 chunks for better context
    if (intent === "procedure") {
      const chunks = await retrieveSemanticChunks(embedding, 5);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "No relevant information found in the documents.",
        };
      }

      console.log(
        `📋 Retrieved ${chunks.length} chunks for procedure question`
      );
      const answer = await generateProcedureAnswer(question, chunks);
      return { answer };
    }

    // 📅 Deadline questions - top 3 chunks
    if (intent === "deadline") {
      const chunks = await retrieveSemanticChunks(embedding, 3);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "No deadline information found in the documents.",
        };
      }

      console.log(`⏰ Retrieved ${chunks.length} chunks for deadline question`);
      // Use semantic answer with focused context
      const answer = await generateSemanticAnswer(question, chunks);
      return { answer };
    }

    // ✅ Requirement questions - top 4 chunks
    if (intent === "requirement") {
      const chunks = await retrieveSemanticChunks(embedding, 4);

      if (!chunks || chunks.length === 0) {
        return {
          answer: "No requirement information found in the documents.",
        };
      }

      console.log(
        `📝 Retrieved ${chunks.length} chunks for requirement question`
      );
      const answer = await generateSemanticAnswer(question, chunks);
      return { answer };
    }

    // 🔓 General semantic questions - top 5 chunks
    const chunks = await retrieveSemanticChunks(embedding, 5);

    console.log(`📚 Retrieved ${chunks.length} chunks for general question`);
    console.log(
      `📊 Chunk scores: ${chunks.map((c) => c.score.toFixed(3)).join(", ")}`
    );

    const answer = await generateSemanticAnswer(question, chunks);

    return { answer };
  } catch (error) {
    console.error("❌ Error in handleChat:", error);
    throw error;
  }
}
