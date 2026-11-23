import crypto from "crypto";

/**
 * Safe error responses.
 *
 * Unexpected errors must never be echoed to the client (they can contain
 * Firestore paths, internal URLs or other implementation detail). The full
 * error is logged under a short reference id; the client only gets the id,
 * which an operator can search for in the logs.
 */
export function logError(error, context) {
  const ref = crypto.randomBytes(4).toString("hex");
  console.error(`❌ [${ref}] ${context}:`, error);
  return ref;
}

/** Send a generic 500. `label` is a short, safe description of what failed. */
export function failInternal(res, error, label) {
  const ref = logError(error, label);
  res.status(500).json({
    error: label,
    message: `Something went wrong (ref ${ref})`,
  });
}
