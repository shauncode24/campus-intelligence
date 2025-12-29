// import fetch from "node-fetch";

// export async function getEmbedding(text) {
//   const apiKey = process.env.GOOGLE_API_KEY;

//   if (!apiKey) {
//     throw new Error("GOOGLE_API_KEY is missing");
//   }

//   const url =
//     `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent` +
//     `?key=${apiKey}`;

//   const response = await fetch(url, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       content: {
//         parts: [{ text }],
//       },
//     }),
//   });

//   if (!response.ok) {
//     const error = await response.text();
//     throw new Error(`Embedding API error: ${error}`);
//   }

//   const data = await response.json();
//   return data.embedding.values;
// }
