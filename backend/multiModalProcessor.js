import fetch from "node-fetch";
import pdfParse from "pdf-parse-debugging-disabled";
import { db } from "./firebaseAdmin.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pdfPoppler from "pdf-poppler";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Main function to process document with multi-modal capabilities
 */
export async function processDocumentMultiModal(docId, fileUrl) {
  console.log(`🎨 Starting multi-modal processing for: ${docId}`);

  let tempPdfPath = null;

  try {
    // Step 1: Download the PDF
    const pdfBuffer = await downloadPDF(fileUrl);

    // Save to temp file for processing
    tempPdfPath = path.join(tempDir, `${docId}.pdf`);
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    // Step 2: Extract text chunks
    const textChunks = await extractTextChunks(pdfBuffer);
    console.log(`📝 Extracted ${textChunks.length} text chunks`);

    // Step 3: Convert PDF pages to images
    const pageImages = await convertPDFToImages(tempPdfPath, docId);
    console.log(`📄 Converted ${pageImages.length} pages to images`);

    // Step 4: Analyze visual elements with Gemini Vision
    const visualChunks = await analyzeVisualElements(pageImages, docId);
    console.log(`🔍 Created ${visualChunks.length} visual chunks`);

    // Step 5: Store all chunks in Firestore
    await storeMultiModalChunks(docId, textChunks, visualChunks);

    // Step 6: Cleanup temp files
    await cleanupTempFiles(docId, pageImages.length);

    return {
      success: true,
      textChunks: textChunks.length,
      visualChunks: visualChunks.length,
      totalChunks: textChunks.length + visualChunks.length,
    };
  } catch (error) {
    console.error("❌ Multi-modal processing error:", error);

    // Cleanup on error
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }

    throw error;
  }
}

/**
 * Download PDF from URL
 */
async function downloadPDF(fileUrl) {
  console.log("⬇️  Downloading PDF...");
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Extract text and create smart chunks
 */
async function extractTextChunks(pdfBuffer) {
  const data = await pdfParse(pdfBuffer);
  const text = data.text;

  const chunks = [];
  const maxChunkSize = 1500;
  const overlap = 200;

  let sections = text.split(/\n\n+/);
  let currentChunk = "";

  sections.forEach((section) => {
    const trimmed = section.trim();
    if (!trimmed) return;

    if ((currentChunk + "\n\n" + trimmed).length > maxChunkSize) {
      if (currentChunk) {
        chunks.push({
          type: "text",
          content: currentChunk.trim(),
          metadata: {
            length: currentChunk.length,
          },
        });

        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + "\n\n" + trimmed;
      } else {
        const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
        let sentenceChunk = "";

        sentences.forEach((sentence) => {
          if ((sentenceChunk + sentence).length > maxChunkSize) {
            if (sentenceChunk) {
              chunks.push({
                type: "text",
                content: sentenceChunk.trim(),
                metadata: { length: sentenceChunk.length },
              });
            }
            sentenceChunk = sentence;
          } else {
            sentenceChunk += sentence;
          }
        });

        if (sentenceChunk) currentChunk = sentenceChunk;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  });

  if (currentChunk.trim()) {
    chunks.push({
      type: "text",
      content: currentChunk.trim(),
      metadata: { length: currentChunk.length },
    });
  }

  return chunks.filter((c) => c.content.length > 50);
}

/**
 * Convert PDF pages to images using pdf-poppler
 */
async function convertPDFToImages(pdfPath, docId) {
  console.log("🖼️  Converting PDF pages to images...");

  try {
    const options = {
      format: "jpeg",
      out_dir: tempDir,
      out_prefix: `${docId}_page`,
      page: null, // Convert all pages
      scale: 2048, // High quality
    };

    // Convert PDF to images
    await pdfPoppler.convert(pdfPath, options);

    // Find generated image files
    const files = fs.readdirSync(tempDir);
    const imageFiles = files
      .filter((f) => f.startsWith(`${docId}_page`) && f.endsWith(".jpg"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/page-(\d+)/)?.[1] || "0");
        const numB = parseInt(b.match(/page-(\d+)/)?.[1] || "0");
        return numA - numB;
      });

    // Limit to first 10 pages to avoid API quota issues
    const pagesToProcess = imageFiles.slice(0, 10);

    console.log(
      `📊 Processing ${pagesToProcess.length} pages (of ${imageFiles.length} total)`
    );

    return pagesToProcess.map((filename, index) => ({
      pageNumber: index + 1,
      filename: filename,
      path: path.join(tempDir, filename),
    }));
  } catch (error) {
    console.error("Error converting PDF to images:", error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

/**
 * Analyze visual elements using Gemini Vision API
 * FIXED: Increased maxOutputTokens to 4096 to prevent truncation
 */
async function analyzeVisualElements(pageImages, docId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for vision analysis");
  }

  const visualChunks = [];

  for (const pageImg of pageImages) {
    console.log(`🔍 Analyzing page ${pageImg.pageNumber}...`);

    try {
      // Convert image to base64
      const imageBuffer = fs.readFileSync(pageImg.path);
      const base64Image = imageBuffer.toString("base64");

      const prompt = `Analyze this document page and extract ALL information in COMPLETE detail.

CRITICAL RULES:
1. Extract COMPLETE data - do NOT truncate numbers, IP addresses, or any values
2. For tables: List EVERY row and EVERY column with FULL values
3. For forms: Include ALL field labels completely
4. For diagrams: Describe ALL devices, connections, and labels
5. For text: Extract ALL visible content completely

WHAT TO EXTRACT:

**Tables & Data:**
- List complete table structure with ALL headers
- Include EVERY row with ALL column values (complete IP addresses, subnet masks, gateway addresses)
- Do NOT abbreviate or truncate any numbers

**Forms & Applications:**
- List ALL form fields with complete labels
- Include all checkboxes, dropdowns, text fields
- Note all instructions

**Network Diagrams/Charts:**
- Describe ALL devices shown
- List ALL connections and their labels
- Include ALL IP addresses, hostnames, interface names
- Note cable types, protocols

**Text Content:**
- Extract ALL commands, configurations
- Include ALL instructions and notes
- Preserve formatting where important

**Visual Elements:**
- Describe charts, maps, logos, stamps
- Note any callouts or highlights

Be exhaustive and complete. Do not summarize or skip details.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: "image/jpeg",
                      data: base64Image,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1, // Lower temperature for more accurate extraction
              maxOutputTokens: 4096, // INCREASED from 1024 to prevent truncation
              topP: 0.95,
              topK: 40,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(
          `❌ Vision API error for page ${pageImg.pageNumber}:`,
          error
        );
        continue;
      }

      const data = await response.json();
      const description = data.candidates[0].content.parts[0].text;

      // Only create chunk if there's meaningful visual content
      const hasVisualContent =
        !description.toLowerCase().includes("no significant visual elements") &&
        !description.toLowerCase().includes("plain text page") &&
        description.length > 50;

      if (hasVisualContent) {
        visualChunks.push({
          type: "visual",
          content: description,
          metadata: {
            pageNumber: pageImg.pageNumber,
            analysisType: "vision",
            hasVisualElements: true,
          },
        });

        console.log(`✅ Page ${pageImg.pageNumber}: Found visual elements`);
      } else {
        console.log(`📄 Page ${pageImg.pageNumber}: Plain text only`);
      }

      // Rate limiting - wait 1 second between requests
      await sleep(1000);
    } catch (error) {
      console.error(
        `Error analyzing page ${pageImg.pageNumber}:`,
        error.message
      );
    }
  }

  return visualChunks;
}

/**
 * Store multi-modal chunks in Firestore
 */
async function storeMultiModalChunks(docId, textChunks, visualChunks) {
  const batch = db.batch();
  let chunkIndex = 0;

  // Store text chunks
  for (const chunk of textChunks) {
    const ref = db.collection("chunks").doc();
    batch.set(ref, {
      documentId: docId,
      index: chunkIndex++,
      type: chunk.type,
      content: chunk.content,
      metadata: chunk.metadata,
      createdAt: new Date(),
      isMultiModal: true,
    });
  }

  // Store visual chunks
  for (const chunk of visualChunks) {
    const ref = db.collection("chunks").doc();
    batch.set(ref, {
      documentId: docId,
      index: chunkIndex++,
      type: chunk.type,
      content: chunk.content,
      metadata: chunk.metadata,
      createdAt: new Date(),
      isMultiModal: true,
    });
  }

  await batch.commit();
  console.log(`💾 Stored ${chunkIndex} multi-modal chunks`);
}

/**
 * Cleanup temporary files
 */
async function cleanupTempFiles(docId, pageCount) {
  try {
    // Remove PDF file
    const pdfPath = path.join(tempDir, `${docId}.pdf`);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    // Remove image files
    const files = fs.readdirSync(tempDir);
    files
      .filter((f) => f.startsWith(`${docId}_page`))
      .forEach((f) => {
        const filePath = path.join(tempDir, f);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });

    console.log("🧹 Cleaned up temporary files");
  } catch (error) {
    console.error("⚠️  Error cleaning up temp files:", error);
  }
}

/**
 * Helper: Sleep function
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
