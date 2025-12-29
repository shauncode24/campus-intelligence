// import dotenv from "dotenv";
// dotenv.config();

// import { db } from "./firebaseAdmin.js";
// import { getEmbedding } from "./embedding.js";

// async function run() {
//   const snapshot = await db.collection("chunks").get();

//   for (const doc of snapshot.docs) {
//     const data = doc.data();

//     if (data.embedding) {
//       console.log("Skipping:", doc.id);
//       continue;
//     }

//     console.log("Embedding chunk:", doc.id);

//     const embedding = await getEmbedding(data.content);

//     await doc.ref.update({
//       embedding,
//     });
//   }

//   console.log("✅ All chunks embedded");
// }

// run();
