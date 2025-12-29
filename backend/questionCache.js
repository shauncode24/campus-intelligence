import { db } from "./firebaseAdmin.js";

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
    // Temporary: Get without orderBy to avoid index requirement
    // After creating the Firebase index, you can add .orderBy("askedAt", "desc")
    const snapshot = await db
      .collection("user_questions")
      .where("userId", "==", userId)
      .get();

    const history = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // Fetch the full question details
      let questionData = null;
      if (data.questionId) {
        try {
          const questionDoc = await db
            .collection("questions")
            .doc(data.questionId)
            .get();
          questionData = questionDoc.exists ? questionDoc.data() : null;
        } catch (err) {
          console.error("Error fetching question details:", err);
        }
      }

      history.push({
        id: doc.id,
        questionText: data.questionText,
        answer: questionData?.answer || "Answer not found",
        askedAt: data.askedAt,
      });
    }

    // Sort in JavaScript instead of Firebase (temporary workaround)
    history.sort((a, b) => {
      const timeA = a.askedAt?._seconds || 0;
      const timeB = b.askedAt?._seconds || 0;
      return timeB - timeA; // Descending (newest first)
    });

    // Limit after sorting
    return history.slice(0, limit);
  } catch (error) {
    console.error("Error fetching user history:", error);
    return [];
  }
}
