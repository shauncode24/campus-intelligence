import fetch from "node-fetch";

// function calculateConfidence(chunks, intent) {
//   if (!chunks || chunks.length === 0) {
//     return { level: "Low", score: 0, reasoning: "No relevant sources found" };
//   }

//   const topScore = chunks[0].score;
//   const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;

//   const highQualityChunks = chunks.filter((c) => c.score > 0.75).length;

//   let level, score, reasoning;

//   if (topScore > 0.9 && avgScore > 0.8 && highQualityChunks >= 2) {
//     level = "High";
//     score = Math.round(topScore * 100);
//     reasoning = `Strong match found across ${highQualityChunks} high-quality sources`;
//   } else if (topScore > 0.8 && avgScore > 0.7) {
//     level = "Medium";
//     score = Math.round(topScore * 100);
//     reasoning = `Good match found, but sources show some variation`;
//   } else {
//     level = "Low";
//     score = Math.round(topScore * 100);
//     reasoning = `Limited or inconsistent source information`;
//   }

//   return { level, score, reasoning };
// }

// function extractSourceInfo(chunks) {
//   const sources = [];
//   const seenDocs = new Set();

//   chunks.forEach((chunk, index) => {
//     const docId = chunk.documentId;

//     if (!seenDocs.has(docId)) {
//       seenDocs.add(docId);

//       sources.push({
//         documentId: docId,
//         chunkIndex: chunk.index,
//         similarity: Math.round(chunk.score * 100),
//         excerpt: chunk.content.slice(0, 150) + "...",
//         documentName: chunk.documentName || "Unknown Document",
//         fileUrl: chunk.fileUrl || null,
//       });
//     }
//   });

//   return sources;
// }

export function extractDeadline(answerText, intent) {
  console.log("🔍 Full answer being checked:", answerText);

  if (intent !== "deadline" && !answerText.toLowerCase().includes("deadline")) {
    return null;
  }

  const datePatterns = [
    /([A-Z][a-z]+ \d{1,2},? \d{4})/g,
    /(\d{4}-\d{2}-\d{2})/g,
    /(\d{1,2}\/\d{1,2}\/\d{4})/g,
    /([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th),? \d{4})/g,
    /(\d{1,2}(?:st|nd|rd|th) [A-Z][a-z]+ \d{4})/g,
    /(\d{1,2} [A-Z][a-z]+ \d{4})/g,
  ];

  let foundDate = null;
  let dateString = null;

  for (const pattern of datePatterns) {
    const matches = answerText.match(pattern);
    if (matches && matches.length > 0) {
      dateString = matches[0];
      console.log("✅ Found date string:", dateString);

      try {
        foundDate = new Date(dateString);

        if (!isNaN(foundDate.getTime())) {
          console.log("✅ Valid date object created:", foundDate);
          break;
        }
      } catch (e) {
        console.log("❌ Failed to parse:", dateString);
        continue;
      }
    }
  }

  if (!foundDate || isNaN(foundDate.getTime())) {
    console.log("❌ No valid date found in answer");
    return null;
  }

  const now = new Date();
  if (foundDate <= now) {
    console.log("❌ Date is in the past:", foundDate);
    return null;
  }

  console.log("✅ Found future deadline!", foundDate);

  const dateIndex = answerText.indexOf(dateString);
  const contextStart = Math.max(0, dateIndex - 50);
  const contextEnd = Math.min(answerText.length, dateIndex + 100);
  const context = answerText.slice(contextStart, contextEnd).trim();

  let title = "Campus Deadline";
  const titlePatterns = [
    /(?:deadline for|deadline is for|submission deadline for|due date for)\s+([^.]+)/i,
    /([^.]+)\s+(?:deadline|due date)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = answerText.match(pattern);
    if (match && match[1]) {
      title = match[1].trim();
      if (title.length > 60) {
        title = title.slice(0, 60) + "...";
      }
      break;
    }
  }

  const formattedDate = foundDate.toISOString().split("T")[0];

  return {
    title,
    date: formattedDate,
    originalDateString: dateString,
    context,
    fullAnswer: answerText,
  };
}

export function enhanceAnswerWithDeadline(answer, intent, sources = []) {
  const deadline = extractDeadline(answer, intent);

  console.log("📅 Deadline extraction:", {
    intent,
    foundDeadline: !!deadline,
    answer: answer.substring(0, 100),
  });

  if (!deadline) {
    return { answer, deadline: null };
  }

  if (sources && sources.length > 0) {
    deadline.sourceDocument = sources[0].documentName;
  }

  return {
    answer,
    deadline: {
      ...deadline,
      description: `Deadline extracted from campus documents`,
      canAddToCalendar: true,
    },
  };
}

// Helper function to stream from Gemini API with character-by-character smoothing
async function streamGeminiResponse(prompt, res, temperature = 0.3) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  console.log("🌊 Starting Gemini streaming request...");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: 2048,
          topP: 0.95,
          topK: 40,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Generation API error: " + err);
  }

  let fullText = "";
  const decoder = new TextDecoder();

  // Helper function to stream text character by character with delay
  const streamCharByChar = async (text) => {
    // Split into words for more natural streaming
    const words = text.split(/(\s+)/); // Split by whitespace but keep the whitespace

    for (const word of words) {
      // Stream each character of the word
      for (let i = 0; i < word.length; i++) {
        const char = word[i];
        res.write(
          `data: ${JSON.stringify({
            type: "text",
            data: char,
          })}\n\n`
        );

        // Small delay between characters for smooth streaming
        // Punctuation gets slightly longer delay
        const delay = /[.!?,;:]/.test(char) ? 50 : 15;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  };

  // Read the stream
  for await (const chunk of response.body) {
    const text = decoder.decode(chunk, { stream: true });
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          const data = JSON.parse(jsonStr);

          // Extract text from candidates
          if (data.candidates && data.candidates[0]) {
            const candidate = data.candidates[0];
            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  fullText += part.text;
                  // Stream character by character with smooth delay
                  await streamCharByChar(part.text);
                }
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON
          console.warn("Failed to parse chunk:", e.message);
        }
      }
    }
  }

  console.log("✅ Streaming completed, total length:", fullText.length);
  return fullText;
}

// Streaming version of generateSemanticAnswer
export async function generateSemanticAnswerStream(question, chunks, res) {
  const maxChunks = 5;
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

  const prompt = `Answer using ONLY these documents:

${context}

Q: ${question}

CRITICAL: Your answer must be 200 words or less. Be direct and concise. Cite [1], [2].`;

  console.log("🌊 Starting streaming semantic generation...");

  const answer = await streamGeminiResponse(prompt, res, 0.3);

  const confidence = calculateConfidence(chunks, "general");
  const sources = extractSourceInfo(chunks);

  return { answer, confidence, sources };
}

// Streaming version of generateDefinitionAnswer
export async function generateDefinitionAnswerStream(question, chunks, res) {
  const maxChunks = 3;
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

  const prompt = `Answer from documents. If not found, say "Not found."

DOCS:
${context}

Q: ${question}

IMPORTANT: Keep answer to 150 words maximum. Be concise. Cite [1], [2].`;

  console.log("🌊 Starting streaming definition generation...");

  const answer = await streamGeminiResponse(prompt, res, 0.3);

  const confidence = calculateConfidence(chunks, "definition");
  const sources = extractSourceInfo(chunks);

  return { answer, confidence, sources };
}

// Streaming version of generateProcedureAnswer
export async function generateProcedureAnswerStream(question, chunks, res) {
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

  console.log("🌊 Starting streaming procedure generation...");

  const answer = await streamGeminiResponse(prompt, res, 0.2);

  const confidence = calculateConfidence(chunks, "procedure");
  const sources = extractSourceInfo(chunks);

  return { answer, confidence, sources };
}

// Keep the original non-streaming functions for backward compatibility
// export async function generateDefinitionAnswer(question, chunks) {
//   return generateAnswer(question, chunks, true);
// }

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

  const confidence = calculateConfidence(
    chunks,
    strict ? "definition" : "general"
  );

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

  return {
    answer: response,
    confidence,
    sources,
  };
}

async function generateStructuredAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const confidence = calculateConfidence(chunks, "procedure");
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

  return {
    answer: response,
    confidence,
    sources,
  };
}

async function generateTimelineAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;

  const confidence = calculateConfidence(chunks, "deadline");
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

export async function generateEnhancedAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const textChunks = chunks.filter((c) => c.type === "text" || !c.type);
  const visualChunks = chunks.filter((c) => c.type === "visual");

  const confidence = calculateConfidence(chunks, "general");
  const sources = extractSourceInfo(chunks);

  // Build context with better formatting
  let context = "";

  if (visualChunks.length > 0) {
    context += "VISUAL CONTENT (tables, forms, diagrams from pages):\n";
    visualChunks.forEach((c, i) => {
      const pageNum = c.metadata?.pageNumber || "?";
      context += `[V${i + 1}] Page ${pageNum}:\n${c.content}\n\n`;
    });
  }

  if (textChunks.length > 0) {
    context += "TEXT CONTENT:\n";
    textChunks.forEach((c, i) => {
      const content =
        c.content.length > 1200 ? c.content.slice(0, 1200) + "..." : c.content;
      context += `[T${i + 1}] ${content}\n\n`;
    });
  }

  // IMPROVED PROMPT - handles both specific and general queries
  const prompt = `You are a precise campus information assistant. Answer the question using ONLY the provided documents.

${context}

Question: ${question}

**CRITICAL INSTRUCTIONS:**
1. For specific queries (e.g., "what is X's Y"), search ALL content carefully and provide the EXACT answer
2. If the answer exists in the documents, state it directly - never say "not found" if it's there
3. For tables: Search through ALL entries to find the specific value requested
4. Cite sources: [V1], [V2] for visual content, [T1], [T2] for text
5. Keep answer under 250 words
6. If the information truly doesn't exist, only then say "not found"

Answer the question directly and precisely:`;

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
          temperature: 0.2, // Lower temperature for more precise answers
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

  return {
    answer: response,
    confidence,
    sources,
    hasVisualContent: visualChunks.length > 0,
  };
}

/**
 * Calculate confidence score
 */
export async function generateDefinitionAnswer(question, chunks) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const confidence = calculateConfidence(chunks, "definition");
  const sources = extractSourceInfo(chunks);

  const textChunks = chunks.filter((c) => c.type === "text" || !c.type);
  const visualChunks = chunks.filter((c) => c.type === "visual");

  let context = "";

  // Prioritize visual content for specific queries
  if (visualChunks.length > 0) {
    context += "VISUAL CONTENT:\n";
    visualChunks.forEach((c, i) => {
      context += `[V${i + 1}] ${c.content}\n\n`;
    });
  }

  if (textChunks.length > 0) {
    context += "TEXT CONTENT:\n";
    const limitedTextChunks = textChunks.slice(0, 3).map((chunk) => ({
      ...chunk,
      content:
        chunk.content.length > 1200
          ? chunk.content.slice(0, 1200) + "..."
          : chunk.content,
    }));

    limitedTextChunks.forEach((c, i) => {
      context += `[T${i + 1}] ${c.content}\n\n`;
    });
  }

  // IMPROVED PROMPT for specific queries
  const prompt = `Answer this specific question using the provided documents.

${context}

Question: ${question}

**CRITICAL RULES:**
1. Search ALL content (both visual and text) for the answer
2. For questions like "what is X's Y", find X in the content and report Y's value
3. Look in tables, lists, and structured data carefully
4. If the value exists, provide it precisely
5. Only say "not found" if you've checked everywhere and it truly doesn't exist
6. Cite sources: [V1], [V2] or [T1], [T2]
7. Keep answer under 150 words

Provide the precise answer:`;

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
          temperature: 0.1, // Very low for precise extraction
          maxOutputTokens: 1024,
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

  return {
    answer: response,
    confidence,
    sources,
  };
}

// Keep all other existing functions...
function calculateConfidence(chunks, intent) {
  if (!chunks || chunks.length === 0) {
    return { level: "Low", score: 0, reasoning: "No relevant sources found" };
  }

  const topScore = chunks[0].score;
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;
  const highQualityChunks = chunks.filter((c) => c.score > 0.75).length;

  let level, score, reasoning;

  if (topScore > 0.9 && avgScore > 0.8 && highQualityChunks >= 2) {
    level = "High";
    score = Math.round(topScore * 100);
    reasoning = `Strong match found across ${highQualityChunks} high-quality sources`;
  } else if (topScore > 0.8 && avgScore > 0.7) {
    level = "Medium";
    score = Math.round(topScore * 100);
    reasoning = `Good match found, but sources show some variation`;
  } else {
    level = "Low";
    score = Math.round(topScore * 100);
    reasoning = `Limited or inconsistent source information`;
  }

  return { level, score, reasoning };
}

function extractSourceInfo(chunks) {
  const sources = [];
  const seenDocs = new Set();

  chunks.forEach((chunk) => {
    const docId = chunk.documentId;

    if (!seenDocs.has(docId)) {
      seenDocs.add(docId);

      sources.push({
        documentId: docId,
        chunkIndex: chunk.index,
        similarity: Math.round(chunk.score * 100),
        excerpt: chunk.content.slice(0, 150) + "...",
        documentName: chunk.documentName || "Unknown Document",
        fileUrl: chunk.fileUrl || null,
        type: chunk.type || "text",
        pageNumber: chunk.metadata?.pageNumber || null,
      });
    }
  });

  return sources;
}

/**
 * Extract source information
 */
// function extractSourceInfo(chunks) {
//   const sources = [];
//   const seenDocs = new Set();

//   chunks.forEach((chunk, index) => {
//     const docId = chunk.documentId;

//     if (!seenDocs.has(docId)) {
//       seenDocs.add(docId);

//       sources.push({
//         documentId: docId,
//         chunkIndex: chunk.index,
//         similarity: Math.round(chunk.score * 100),
//         excerpt: chunk.content.slice(0, 150) + "...",
//         documentName: chunk.documentName || "Unknown Document",
//         fileUrl: chunk.fileUrl || null,
//         type: chunk.type || "text",
//         pageNumber: chunk.metadata?.pageNumber || null,
//       });
//     }
//   });

//   return sources;
// }
