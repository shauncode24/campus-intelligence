import { db } from "./firebaseAdmin.js";
import { processDocument } from "./processDocuments.js";

async function run() {
  const snapshot = await db.collection("documents").get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`Processing: ${data.name}`);
    await processDocument(doc.id, data.fileUrl);
  }

  console.log("All documents processed");
}

run();
