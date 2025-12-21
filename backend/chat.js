import { getEmbedding } from "./embedding.js";
import { retrieveSemanticChunks } from "./retrieve.js";
import { generateDefinitionAnswer, generateSemanticAnswer } from "./answer.js";

function isDefinitionQuestion(q) {
  return /^(what is|define|what does|what are)\b/i.test(q.trim());
}

export async function handleChat(question) {
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

    const answer = await generateDefinitionAnswer(question, chunks[0]);
    return { answer };
  }

  // For general questions, get top 5 chunks
  const chunks = await retrieveSemanticChunks(embedding, 5);
  const answer = await generateSemanticAnswer(question, chunks);

  return { answer };
}
