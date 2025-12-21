import fetch from "node-fetch";
import pdfParse from "pdf-parse-debugging-disabled";
import { db } from "./firebaseAdmin.js";

function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

export async function processDocument(docId, fileUrl) {
  try {
    console.log(`Fetching PDF from: ${fileUrl}`);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    console.log(`PDF downloaded, size: ${buffer.byteLength} bytes`);

    // Parse the PDF - simple and clean
    const data = await pdfParse(Buffer.from(buffer));
    const text = data.text;

    console.log(`Extracted text length: ${text.length} characters`);
    console.log(`First 200 chars: ${text.slice(0, 200)}`);

    // Create chunks
    const chunks = chunkText(text, 500, 100);
    console.log(`Created ${chunks.length} chunks`);

    // Store chunks in Firestore
    const batch = db.batch();
    chunks.forEach((chunk, index) => {
      const ref = db.collection("chunks").doc();
      batch.set(ref, {
        documentId: docId,
        index,
        content: chunk,
        createdAt: new Date(),
      });
    });

    await batch.commit();
    console.log(
      `✅ Successfully stored ${chunks.length} chunks for document ${docId}`
    );

    return { success: true, chunksCount: chunks.length };
  } catch (error) {
    console.error(`❌ Error processing document ${docId}:`, error.message);
    throw error;
  }
}
