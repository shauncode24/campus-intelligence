import fetch from "node-fetch";

export async function generateDefinitionAnswer(question, chunks) {
  return generateAnswer(question, chunks, true);
}

export async function generateSemanticAnswer(question, chunks) {
  return generateAnswer(question, chunks, false);
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

  // Use gemini-1.5-pro (stable, larger context and output limits)
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
          maxOutputTokens: 2048, // Pro model can handle more
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
    console.warn(`⚠️  Hit max tokens - model ignored word limit instruction`);
  } else {
    console.warn(`⚠️  Finish reason: ${finishReason}`);
  }

  return response;
}
