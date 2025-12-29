// // ============================================
// // FILE: multiModalAnswer.js
// // Enhanced answer generation for multi-modal content
// // ============================================

// import fetch from "node-fetch";

// /**
//  * Generate answer considering both text and visual chunks
//  */
// export async function generateMultiModalAnswer(question, chunks) {
//   const apiKey = process.env.GOOGLE_API_KEY;

//   // Separate text and visual chunks
//   const textChunks = chunks.filter((c) => c.type === "text");
//   const visualChunks = chunks.filter((c) => c.type === "visual");

//   // Build context
//   let context = "";

//   if (textChunks.length > 0) {
//     context += "TEXT CONTENT:\n";
//     textChunks.forEach((c, i) => {
//       context += `[${i + 1}] ${c.content}\n\n`;
//     });
//   }

//   if (visualChunks.length > 0) {
//     context += "\nVISUAL CONTENT (forms, tables, diagrams, maps):\n";
//     visualChunks.forEach((c, i) => {
//       context += `[V${i + 1}] Page ${c.metadata.pageNumber}: ${c.content}\n\n`;
//     });
//   }

//   const prompt = `You are a campus information assistant with access to both text and visual content from official documents.

// ${context}

// Question: ${question}

// Instructions:
// - If the question asks about visual content (forms, maps, tables), prioritize visual chunks
// - Be specific about where information comes from (page numbers for visual content)
// - If showing a form, list all the fields clearly
// - If describing a map or diagram, be spatially specific
// - Cite sources using [1], [2] for text and [V1], [V2] for visual content
// - Keep answer under 250 words

// Answer:`;

//   const response = await fetch(
//     `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
//     {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         contents: [{ parts: [{ text: prompt }] }],
//         generationConfig: {
//           temperature: 0.3,
//           maxOutputTokens: 2048,
//         },
//       }),
//     }
//   );

//   const data = await response.json();
//   const answer = data.candidates[0].content.parts[0].text;

//   return {
//     answer,
//     hasVisualContent: visualChunks.length > 0,
//     visualPages: visualChunks.map((c) => c.metadata.pageNumber),
//   };
// }
