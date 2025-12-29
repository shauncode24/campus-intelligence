// import { db } from "./firebaseAdmin.js";
// import { processDocument } from "./processDocuments.js";

// async function run() {
//   const docsSnapshot = await db.collection("documents").get();

//   for (const doc of docsSnapshot.docs) {
//     const docId = doc.id;
//     const data = doc.data();

//     // Check if chunks already exist
//     const chunksSnapshot = await db
//       .collection("chunks")
//       .where("documentId", "==", docId)
//       .limit(1)
//       .get();

//     if (!chunksSnapshot.empty) {
//       console.log(`Skipping already processed: ${data.name}`);
//       continue;
//     }

//     console.log(`Processing new document: ${data.name}`);
//     await processDocument(docId, data.fileUrl);
//   }

//   console.log("Document processing complete");
// }

// run();
