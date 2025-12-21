import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import { generateDefinitionAnswer, generateSemanticAnswer } from "./answer.js";

function isDefinitionQuestion(q) {
  return /^(what is|define|what does|what are)\b/i.test(q.trim());
}

export async function handleChat(question) {
  try {
    // Get embedding for the question
    const embedding = await getEmbedding(question);

    if (isDefinitionQuestion(question)) {
      // For definitions, get top 3 most relevant chunks
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

    // For complex questions, get top 5 chunks
    const chunks = await retrieveSemanticChunks(embedding, 5);

    console.log(`📚 Retrieved ${chunks.length} chunks for semantic question`);
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
