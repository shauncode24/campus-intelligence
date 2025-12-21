import fetch from "node-fetch";
import pdfParse from "pdf-parse-debugging-disabled";
import { db } from "./firebaseAdmin.js";

/**
 * Smart chunking that respects document structure
 * Works with ANY document type - detects common patterns
 */
function smartChunkText(text) {
  const chunks = [];
  const maxChunkSize = 1500;
  const overlap = 200;

  // Split by multiple paragraph breaks (sections are usually separated by 2+ newlines)
  let sections = text.split(/\n\n+/);

  let currentChunk = "";

  sections.forEach((section) => {
    const trimmed = section.trim();
    if (!trimmed) return;

    // Check if adding this section would exceed chunk size
    if ((currentChunk + "\n\n" + trimmed).length > maxChunkSize) {
      // Current chunk is full, save it
      if (currentChunk) {
        chunks.push(currentChunk.trim());

        // Start new chunk with overlap (last 200 chars of previous chunk)
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + "\n\n" + trimmed;
      } else {
        // Single section is larger than maxChunkSize
        // Split it further by sentences
        const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
        let sentenceChunk = "";

        sentences.forEach((sentence) => {
          if ((sentenceChunk + sentence).length > maxChunkSize) {
            if (sentenceChunk) chunks.push(sentenceChunk.trim());
            sentenceChunk = sentence;
          } else {
            sentenceChunk += sentence;
          }
        });

        if (sentenceChunk) currentChunk = sentenceChunk;
      }
    } else {
      // Add section to current chunk
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  });

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Fallback: if something went wrong, use simple sliding window
  if (chunks.length === 0) {
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + maxChunkSize, text.length);
      chunks.push(text.slice(start, end).trim());
      start += maxChunkSize - overlap;
    }
  }

  return chunks.filter((c) => c.length > 50); // Filter out tiny chunks
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

    // Parse the PDF
    const data = await pdfParse(Buffer.from(buffer));
    const text = data.text;

    console.log(`Extracted text length: ${text.length} characters`);

    // Create smart chunks
    const chunks = smartChunkText(text);
    console.log(`Created ${chunks.length} chunks`);

    // Log chunk sizes for debugging
    chunks.forEach((chunk, i) => {
      console.log(
        `Chunk ${i}: ${chunk.length} chars, starts with: ${chunk.slice(
          0,
          60
        )}...`
      );
    });

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
