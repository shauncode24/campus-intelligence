// import fetch from "node-fetch";
// import pdfParse from "pdf-parse-debugging-disabled";
// import { db } from "./firebaseAdmin.js";
// import fs from "fs";
// import path from "path";
// import { fileURLToPath } from "url";
// import pdfPoppler from "pdf-poppler";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const tempDir = path.join(__dirname, "temp");
// if (!fs.existsSync(tempDir)) {
//   fs.mkdirSync(tempDir, { recursive: true });
// }

// /**
//  * Main function to process document with multi-modal capabilities
//  */
// export async function processDocumentMultiModal(docId, fileUrl) {
//   console.log(`🎨 Starting multi-modal processing for: ${docId}`);

//   let tempPdfPath = null;

//   try {
//     const pdfBuffer = await downloadPDF(fileUrl);
//     tempPdfPath = path.join(tempDir, `${docId}.pdf`);
//     fs.writeFileSync(tempPdfPath, pdfBuffer);

//     const textChunks = await extractTextChunks(pdfBuffer);
//     console.log(`📝 Extracted ${textChunks.length} text chunks`);

//     const pageImages = await convertPDFToImages(tempPdfPath, docId);
//     console.log(`📄 Converted ${pageImages.length} pages to images`);

//     const visualChunks = await analyzeVisualElements(pageImages, docId);
//     console.log(`🔍 Created ${visualChunks.length} visual chunks`);

//     await storeMultiModalChunks(docId, textChunks, visualChunks);
//     await cleanupTempFiles(docId, pageImages.length);

//     return {
//       success: true,
//       textChunks: textChunks.length,
//       visualChunks: visualChunks.length,
//       totalChunks: textChunks.length + visualChunks.length,
//     };
//   } catch (error) {
//     console.error("❌ Multi-modal processing error:", error);
//     if (tempPdfPath && fs.existsSync(tempPdfPath)) {
//       fs.unlinkSync(tempPdfPath);
//     }
//     throw error;
//   }
// }

// async function downloadPDF(fileUrl) {
//   console.log("⬇️ Downloading PDF...");
//   const response = await fetch(fileUrl);
//   if (!response.ok) {
//     throw new Error(`Failed to download PDF: ${response.statusText}`);
//   }
//   const arrayBuffer = await response.arrayBuffer();
//   return Buffer.from(arrayBuffer);
// }

// async function extractTextChunks(pdfBuffer) {
//   const data = await pdfParse(pdfBuffer);
//   const text = data.text;

//   const chunks = [];
//   const maxChunkSize = 1500;
//   const overlap = 200;

//   let sections = text.split(/\n\n+/);
//   let currentChunk = "";

//   sections.forEach((section) => {
//     const trimmed = section.trim();
//     if (!trimmed) return;

//     if ((currentChunk + "\n\n" + trimmed).length > maxChunkSize) {
//       if (currentChunk) {
//         chunks.push({
//           type: "text",
//           content: currentChunk.trim(),
//           metadata: {
//             length: currentChunk.length,
//           },
//         });

//         const overlapText = currentChunk.slice(-overlap);
//         currentChunk = overlapText + "\n\n" + trimmed;
//       } else {
//         const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
//         let sentenceChunk = "";

//         sentences.forEach((sentence) => {
//           if ((sentenceChunk + sentence).length > maxChunkSize) {
//             if (sentenceChunk) {
//               chunks.push({
//                 type: "text",
//                 content: sentenceChunk.trim(),
//                 metadata: { length: sentenceChunk.length },
//               });
//             }
//             sentenceChunk = sentence;
//           } else {
//             sentenceChunk += sentence;
//           }
//         });

//         if (sentenceChunk) currentChunk = sentenceChunk;
//       }
//     } else {
//       currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
//     }
//   });

//   if (currentChunk.trim()) {
//     chunks.push({
//       type: "text",
//       content: currentChunk.trim(),
//       metadata: { length: currentChunk.length },
//     });
//   }

//   return chunks.filter((c) => c.content.length > 50);
// }

// async function convertPDFToImages(pdfPath, docId) {
//   console.log("🖼️ Converting PDF pages to images...");

//   try {
//     const options = {
//       format: "jpeg",
//       out_dir: tempDir,
//       out_prefix: `${docId}_page`,
//       page: null,
//       scale: 2048,
//     };

//     await pdfPoppler.convert(pdfPath, options);

//     const files = fs.readdirSync(tempDir);
//     const imageFiles = files
//       .filter((f) => f.startsWith(`${docId}_page`) && f.endsWith(".jpg"))
//       .sort((a, b) => {
//         const numA = parseInt(a.match(/page-(\d+)/)?.[1] || "0");
//         const numB = parseInt(b.match(/page-(\d+)/)?.[1] || "0");
//         return numA - numB;
//       });

//     const pagesToProcess = imageFiles.slice(0, 10);

//     console.log(
//       `📊 Processing ${pagesToProcess.length} pages (of ${imageFiles.length} total)`
//     );

//     return pagesToProcess.map((filename, index) => ({
//       pageNumber: index + 1,
//       filename: filename,
//       path: path.join(tempDir, filename),
//     }));
//   } catch (error) {
//     console.error("Error converting PDF to images:", error);
//     throw new Error(`PDF conversion failed: ${error.message}`);
//   }
// }

// /**
//  * FIXED: Analyze visual elements with better prompting and higher token limit
//  */
// async function analyzeVisualElements(pageImages, docId) {
//   const apiKey = process.env.GOOGLE_API_KEY;
//   if (!apiKey) {
//     throw new Error("GOOGLE_API_KEY is required for vision analysis");
//   }

//   const visualChunks = [];

//   for (const pageImg of pageImages) {
//     console.log(`🔍 Analyzing page ${pageImg.pageNumber}...`);

//     try {
//       const imageBuffer = fs.readFileSync(pageImg.path);
//       const base64Image = imageBuffer.toString("base64");

//       // IMPROVED PROMPT: More specific and structured
//       const prompt = `Extract ALL information from this document page in a structured, searchable format.

// **CRITICAL INSTRUCTIONS:**
// 1. Extract data in a way that answers SPECIFIC queries (e.g., "what is X's Y")
// 2. For tables: Create clear, complete entries for EACH row
// 3. Use plain language that matches how users ask questions
// 4. Include the actual values, not just descriptions

// **FORMAT YOUR RESPONSE LIKE THIS:**

// **TABLES:**
// [For each table, list it like:]
// Table Name: [name if visible, or "Device Configuration Table"]

// For each row, write complete sentences:
// - [Device/Item] has [property1]: [value1], [property2]: [value2], [property3]: [value3]

// Example:
// - PC0 has IP address: 192.168.1.10, subnet mask: 255.255.255.0, default gateway: 192.168.1.1
// - PC1 has IP address: 192.168.1.11, subnet mask: 255.255.255.0, default gateway: 192.168.1.1

// **FORMS:**
// [List all form fields with labels]

// **DIAGRAMS/NETWORK TOPOLOGY:**
// [Describe all devices, connections, and labels clearly]
// - Device X connects to Device Y via [connection type]
// - Interface labels: [list all]

// **TEXT/COMMANDS:**
// [Extract any visible commands or instructions]

// **IMPORTANT:**
// - Write complete values (full IP addresses, not "192.168...")
// - Make content searchable (someone asking "what is PC2's subnet mask" should find the answer)
// - Be thorough but concise`;

//       const response = await fetch(
//         `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             contents: [
//               {
//                 parts: [
//                   { text: prompt },
//                   {
//                     inline_data: {
//                       mime_type: "image/jpeg",
//                       data: base64Image,
//                     },
//                   },
//                 ],
//               },
//             ],
//             generationConfig: {
//               temperature: 0.1,
//               maxOutputTokens: 8192, // INCREASED from 4096
//               topP: 0.95,
//               topK: 40,
//             },
//           }),
//         }
//       );

//       if (!response.ok) {
//         const error = await response.text();
//         console.error(
//           `❌ Vision API error for page ${pageImg.pageNumber}:`,
//           error
//         );
//         continue;
//       }

//       const data = await response.json();
//       const description = data.candidates[0].content.parts[0].text;

//       // Check if there's meaningful content
//       const hasVisualContent =
//         !description.toLowerCase().includes("no significant visual elements") &&
//         !description.toLowerCase().includes("plain text page") &&
//         description.length > 50;

//       if (hasVisualContent) {
//         visualChunks.push({
//           type: "visual",
//           content: description,
//           metadata: {
//             pageNumber: pageImg.pageNumber,
//             analysisType: "vision",
//             hasVisualElements: true,
//             contentLength: description.length,
//           },
//         });

//         console.log(
//           `✅ Page ${pageImg.pageNumber}: Found visual elements (${description.length} chars)`
//         );
//       } else {
//         console.log(`📄 Page ${pageImg.pageNumber}: Plain text only`);
//       }

//       await sleep(1000);
//     } catch (error) {
//       console.error(
//         `Error analyzing page ${pageImg.pageNumber}:`,
//         error.message
//       );
//     }
//   }

//   return visualChunks;
// }

// async function storeMultiModalChunks(docId, textChunks, visualChunks) {
//   const batch = db.batch();
//   let chunkIndex = 0;

//   for (const chunk of textChunks) {
//     const ref = db.collection("chunks").doc();
//     batch.set(ref, {
//       documentId: docId,
//       index: chunkIndex++,
//       type: chunk.type,
//       content: chunk.content,
//       metadata: chunk.metadata,
//       createdAt: new Date(),
//       isMultiModal: true,
//     });
//   }

//   for (const chunk of visualChunks) {
//     const ref = db.collection("chunks").doc();
//     batch.set(ref, {
//       documentId: docId,
//       index: chunkIndex++,
//       type: chunk.type,
//       content: chunk.content,
//       metadata: chunk.metadata,
//       createdAt: new Date(),
//       isMultiModal: true,
//     });
//   }

//   await batch.commit();
//   console.log(`💾 Stored ${chunkIndex} multi-modal chunks`);
// }

// async function cleanupTempFiles(docId, pageCount) {
//   try {
//     const pdfPath = path.join(tempDir, `${docId}.pdf`);
//     if (fs.existsSync(pdfPath)) {
//       fs.unlinkSync(pdfPath);
//     }

//     const files = fs.readdirSync(tempDir);
//     files
//       .filter((f) => f.startsWith(`${docId}_page`))
//       .forEach((f) => {
//         const filePath = path.join(tempDir, f);
//         if (fs.existsSync(filePath)) {
//           fs.unlinkSync(filePath);
//         }
//       });

//     console.log("🧹 Cleaned up temporary files");
//   } catch (error) {
//     console.error("⚠️ Error cleaning up temp files:", error);
//   }
// }

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }
