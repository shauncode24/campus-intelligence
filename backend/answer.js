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

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.content}`)
    .join("\n\n---\n\n");

  const prompt = strict
    ? `
You are answering based on official documentation.

Extract and synthesize the answer from the documents below.
If the answer spans multiple sections, combine them coherently.
If not found, say "Not found in official documents."

DOCUMENTS:
${context}

QUESTION:
${question}

Instructions:
- Answer directly and completely
- Use 2-5 sentences depending on complexity
- If listing steps or items, format them clearly
- Cite sources like [1], [2] if referencing specific documents
`
    : `
Answer the question using ONLY the information from these official documents.
Combine information from multiple sections if needed.
If not found, say "Not found in official documents."

DOCUMENTS:
${context}

QUESTION:
${question}

Instructions:
- Provide complete, accurate information
- For lists, include all items mentioned
- For processes, include all steps
- Cite sources like [1], [2]
`;

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
          temperature: 0.2, // Lower temperature for more factual responses
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Generation API error: " + err);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}
