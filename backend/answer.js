import fetch from "node-fetch";

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

  // Back to reasonable chunk limits
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
    `🔢 Estimated input tokens: ~${Math.round(estimatedInputTokens)}`
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

  // Use gemini-2.5-flash for faster responses
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

  return response;
}

async function generateStructuredAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  // Limit chunks for procedure questions
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
    `🔢 Estimated input tokens: ~${Math.round(estimatedInputTokens)}`
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
          temperature: 0.2, // Lower temperature for more consistent procedures
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

  return response;
}

async function generateTimelineAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;

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
  return data.candidates[0].content.parts[0].text;
}
