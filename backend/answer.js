import fetch from "node-fetch";

export async function generateDefinitionAnswer(question, chunk) {
  return generateAnswer(question, [chunk], true);
}

export async function generateSemanticAnswer(question, chunks) {
  return generateAnswer(question, chunks, false);
}

async function generateAnswer(question, chunks, strict) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const context = chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n");

  const prompt = strict
    ? `
You are answering a factual lookup question.

ONLY extract the definition that directly answers the question.
DO NOT explain.
DO NOT infer.

DOCUMENT EXCERPT:
${context}

QUESTION:
${question}

Answer in 2–3 sentences maximum.
`
    : `
Answer the question using ONLY the information below.
If not found, say "Not found in official documents."

DOCUMENTS:
${context}

QUESTION:
${question}

Cite sources like [1], [2].
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
