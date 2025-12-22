import { db } from "./firebaseAdmin.js";
import { getEmbedding } from "./embedding.js";

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dot = 0,
    magA = 0,
    magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Search for similar questions in cache
 * @param {Array} questionEmbedding - Embedding of the new question
 * @param {string} intent - Detected intent of the question
 * @param {number} threshold - Similarity threshold (default 0.90)
 * @returns {Object|null} - Cached question data or null
 */
export async function findSimilarQuestion(
  questionEmbedding,
  intent,
  threshold = 0.9
) {
  try {
    const snapshot = await db
      .collection("questions")
      .where("intent", "==", intent)
      .get();

    let bestMatch = null;
    let highestSimilarity = threshold;

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.embedding) return;

      const similarity = cosineSimilarity(questionEmbedding, data.embedding);

      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = {
          id: doc.id,
          ...data,
          similarity,
        };
      }
    });

    if (bestMatch) {
      console.log(
        `✅ Found similar question (similarity: ${bestMatch.similarity.toFixed(
          3
        )})`
      );
      return bestMatch;
    }

    console.log("🔍 No similar question found, will generate new answer");
    return null;
  } catch (error) {
    console.error("Error finding similar question:", error);
    return null;
  }
}

/**
 * Store a new question and answer in cache
 * @param {string} question - The question text
 * @param {Array} embedding - Question embedding
 * @param {string} answer - Generated answer
 * @param {string} intent - Question intent
 * @returns {string} - Document ID of stored question
 */
export async function storeQuestion(question, embedding, answer, intent) {
  try {
    const docRef = await db.collection("questions").add({
      question,
      embedding,
      answer,
      intent,
      count: 1,
      createdAt: new Date(),
      lastAskedAt: new Date(),
    });

    console.log(`💾 Stored new question: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error("Error storing question:", error);
    throw error;
  }
}

/**
 * Update count and timestamp for existing question
 * @param {string} questionId - Document ID of the question
 */
export async function incrementQuestionCount(questionId) {
  try {
    const docRef = db.collection("questions").doc(questionId);

    await docRef.update({
      count: db.FieldValue + 1,
      lastAskedAt: new Date(),
    });

    console.log(
      `📈 Incremented count for question: ${questionId} ${docRef.count}`
    );
  } catch (error) {
    console.error("Error incrementing question count:", error);
  }
}

/**
 * Store user question history
 * @param {string} userId - User identifier (can be session ID)
 * @param {string} questionId - Reference to question document
 * @param {string} questionText - Original question text
 */
export async function storeUserQuestion(userId, questionId, questionText) {
  try {
    await db.collection("user_questions").add({
      userId,
      questionId,
      questionText,
      askedAt: new Date(),
    });

    console.log(`📝 Stored user question history for user: ${userId}`);
  } catch (error) {
    console.error("Error storing user question:", error);
  }
}

/**
 * Get FAQ - most frequently asked questions
 * @param {number} limit - Number of FAQs to retrieve
 * @returns {Array} - Array of FAQ objects
 */
export async function getFAQ(limit = 10) {
  try {
    const snapshot = await db
      .collection("questions")
      .orderBy("count", "desc")
      .limit(limit)
      .get();

    const faqs = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      faqs.push({
        id: doc.id,
        question: data.question,
        answer: data.answer,
        count: data.count,
        intent: data.intent,
      });
    });

    return faqs;
  } catch (error) {
    console.error("Error fetching FAQs:", error);
    return [];
  }
}

/**
 * Get user's question history
 * @param {string} userId - User identifier
 * @param {number} limit - Number of history items to retrieve
 * @returns {Array} - Array of user question history
 */
export async function getUserHistory(userId, limit = 20) {
  try {
    const snapshot = await db
      .collection("user_questions")
      .where("userId", "==", userId)
      .orderBy("askedAt", "desc")
      .limit(limit)
      .get();

    const history = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Fetch the full question details
      let questionData = null;
      if (data.questionId) {
        const questionDoc = await db
          .collection("questions")
          .doc(data.questionId)
          .get();
        questionData = questionDoc.exists ? questionDoc.data() : null;
      }

      history.push({
        id: doc.id,
        questionText: data.questionText,
        answer: questionData?.answer || "Answer not found",
        askedAt: data.askedAt,
      });
    }

    return history;
  } catch (error) {
    console.error("Error fetching user history:", error);
    return [];
  }
}
