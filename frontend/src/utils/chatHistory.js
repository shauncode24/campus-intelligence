// src/utils/chatHistory.js
//
// Builds the "recent turns" sent with a question so the server can understand
// follow-ups like "and the deadline?". The server uses them only to work out what
// the user is referring to, never as evidence for an answer.

const MAX_TURNS = 6;
const MAX_CHARS = 800;

/**
 * @param {Array} messages  the chat as shown on screen, oldest first
 * @returns {Array<{role: "user"|"bot", text: string}>}  the last few useful turns
 */
export function buildHistory(messages, { maxTurns = MAX_TURNS, maxChars = MAX_CHARS } = {}) {
  return (messages || [])
    .filter((m) => {
      if (!m || (m.role !== "user" && m.role !== "bot")) return false;
      if (typeof m.text !== "string" || !m.text.trim()) return false;
      // Failed requests and "not found in the documents" replies tell the server nothing
      if (m.isError) return false;
      if (m.role === "bot" && m.answered === false) return false;
      return true;
    })
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, maxChars) }))
    .slice(-maxTurns);
}
