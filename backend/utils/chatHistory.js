/**
 * Cleans the recent-chat history a client sends with a question.
 *
 * The history is only used to resolve follow-up questions ("and the deadline?"),
 * never as evidence, and it is the requester's own input, so the goals here are
 * bounded size and well-formed turns, not trust.
 *
 * @param {unknown} history
 * @returns {Array<{role: "user"|"bot", text: string}> | null}
 *   the cleaned turns (oldest first), or null if `history` is present but is not an array
 */
export function sanitizeHistory(history, { maxTurns = 6, maxChars = 800 } = {}) {
  if (history === undefined || history === null) return [];
  if (!Array.isArray(history)) return null;

  return history
    .filter(
      (t) =>
        t &&
        (t.role === "user" || t.role === "bot") &&
        typeof t.text === "string" &&
        t.text.trim()
    )
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, maxChars) }))
    .slice(-maxTurns);
}
