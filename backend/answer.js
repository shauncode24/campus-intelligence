import fetch from "node-fetch";

function calculateConfidence(chunks, intent) {
  if (!chunks || chunks.length === 0) {
    return { level: "Low", score: 0, reasoning: "No relevant sources found" };
  }

  const topScore = chunks[0].score;
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;
  const chunkCount = chunks.length;

  // Check for agreement among top chunks
  const highQualityChunks = chunks.filter((c) => c.score > 0.75).length;

  let level, score, reasoning;

  // High confidence criteria
  if (topScore > 0.9 && avgScore > 0.8 && highQualityChunks >= 2) {
    level = "High";
    score = Math.round(topScore * 100);
    reasoning = `Strong match found across ${highQualityChunks} high-quality sources`;
  }
  // Medium confidence criteria
  else if (topScore > 0.8 && avgScore > 0.7) {
    level = "Medium";
    score = Math.round(topScore * 100);
    reasoning = `Good match found, but sources show some variation`;
  }
  // Low confidence criteria
  else {
    level = "Low";
    score = Math.round(topScore * 100);
    reasoning = `Limited or inconsistent source information`;
  }

  return { level, score, reasoning };
}

/**
 * Extract source information from chunks
 */
function extractSourceInfo(chunks) {
  const sources = [];
  const seenDocs = new Set();

  chunks.forEach((chunk, index) => {
    const docId = chunk.documentId;

    // Only add unique documents
    if (!seenDocs.has(docId)) {
      seenDocs.add(docId);

      sources.push({
        documentId: docId,
        chunkIndex: chunk.index,
        similarity: Math.round(chunk.score * 100),
        excerpt: chunk.content.slice(0, 150) + "...",
        documentName: chunk.documentName || "Unknown Document",
        fileUrl: chunk.fileUrl || null,
      });
    }
  });

  return sources;
}

export async function generateDefinitionAnswer(question, chunks) {
  return generateAnswer(question, chunks, true);
}

export async function generateSemanticAnswer(question, chunks) {
  return generateAnswer(question, chunks, false);
}

export async function generateProcedureAnswer(question, chunks) {
  return generateStructuredAnswer(question, chunks);
}

export async function generateDeadlineAnswer(question, chunks) {
  return generateTimelineAnswer(question, chunks);
}

async function generateAnswer(question, chunks, strict) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  // Calculate confidence
  const confidence = calculateConfidence(
    chunks,
    strict ? "definition" : "general"
  );

  // Extract source information
  const sources = extractSourceInfo(chunks);

  const maxChunks = strict ? 3 : 5;
  const maxCharsPerChunk = 1200;

  const limitedChunks = chunks.slice(0, maxChunks).map((chunk) => ({
    ...chunk,
    content:
      chunk.content.length > maxCharsPerChunk
        ? chunk.content.slice(0, maxCharsPerChunk) + "..."
        : chunk.content,
  }));

  const context = limitedChunks
    .map((c, i) => `[${i + 1}] ${c.content}`)
    .join("\n\n");

  const estimatedInputTokens = (context.length + question.length + 200) / 4;
  console.log(
    `📢 Estimated input tokens: ~${Math.round(estimatedInputTokens)}`
  );

  const prompt = strict
    ? `Answer from documents. If not found, say "Not found."

DOCS:
${context}

Q: ${question}

IMPORTANT: Keep answer to 150 words maximum. Be concise. Cite [1], [2].`
    : `Answer using ONLY these documents:

${context}

Q: ${question}

CRITICAL: Your answer must be 200 words or less. Be direct and concise. Cite [1], [2].`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          topP: 0.95,
          topK: 40,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Generation API error: " + err);
  }

  const data = await res.json();

  const response = data.candidates[0].content.parts[0].text;
  const finishReason = data.candidates[0].finishReason;

  if (finishReason === "STOP") {
    console.log(`✅ Generation completed successfully`);
  } else if (finishReason === "MAX_TOKENS") {
    console.warn(`⚠️ Hit max tokens - model ignored word limit instruction`);
  } else {
    console.warn(`⚠️ Finish reason: ${finishReason}`);
  }

  // Return enhanced response with confidence and sources
  return {
    answer: response,
    confidence,
    sources,
  };
}

async function generateStructuredAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  // Calculate confidence
  const confidence = calculateConfidence(chunks, "procedure");

  // Extract source information
  const sources = extractSourceInfo(chunks);

  const maxChunks = 5;
  const maxCharsPerChunk = 1500;

  const limitedChunks = chunks.slice(0, maxChunks).map((chunk) => ({
    ...chunk,
    content:
      chunk.content.length > maxCharsPerChunk
        ? chunk.content.slice(0, maxCharsPerChunk) + "..."
        : chunk.content,
  }));

  const context = limitedChunks
    .map((c, i) => `[Document ${i + 1}]\n${c.content}`)
    .join("\n\n");

  const estimatedInputTokens = (context.length + question.length + 300) / 4;
  console.log(
    `📢 Estimated input tokens: ~${Math.round(estimatedInputTokens)}`
  );

  const prompt = `You are a campus assistant helping students understand official procedures.

Using ONLY the information from the documents below, answer the question as a clear STEP-BY-STEP procedure.

RULES:
- Use numbered steps (1., 2., 3., ...)
- Each step should be clear and actionable
- Be concise but complete
- Include relevant details like deadlines, required documents, or portals
- If the procedure is not clearly stated in the documents, say: "The exact procedure is not explicitly defined in the available documents."
- Do NOT add information not present in the documents
- Cite document references [1], [2], etc. after relevant steps

DOCUMENTS:
${context}

QUESTION:
${question}

Provide your answer as a numbered step-by-step procedure:`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          topP: 0.9,
          topK: 40,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Procedure generation API error: " + err);
  }

  const data = await res.json();

  const response = data.candidates[0].content.parts[0].text;
  const finishReason = data.candidates[0].finishReason;

  if (finishReason === "STOP") {
    console.log(`✅ Procedure generation completed successfully`);
  } else {
    console.warn(`⚠️ Procedure finish reason: ${finishReason}`);
  }

  return {
    answer: response,
    confidence,
    sources,
  };
}

async function generateTimelineAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;

  // Calculate confidence
  const confidence = calculateConfidence(chunks, "deadline");

  // Extract source information
  const sources = extractSourceInfo(chunks);

  const context = chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n");

  const prompt = `
You are a campus assistant.

Your task is to identify DEADLINES or DATES.

Rules:
- Extract exact dates if present
- Do NOT infer or guess
- If no date is explicitly mentioned, say:
  "No deadline is explicitly mentioned in the document."

DOCUMENTS:
${context}

QUESTION:
${question}

Respond clearly and concisely.
`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const data = await res.json();
  const response = data.candidates[0].content.parts[0].text;

  return {
    answer: response,
    confidence,
    sources,
  };
}
