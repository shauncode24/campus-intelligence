// Which state a document is in, from its stored fields. Mirrors the server's rules
// (backend/python/services/document_validity.py), which are what actually decide what
// answers questions; this only decides what the UI shows.

function parseDay(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** "live" | "superseded" | "expired" | "upcoming" | "processing" | "error" | ... (the raw status) */
export function documentState(doc, now = new Date()) {
  if (!doc) return "unknown";
  if (doc.status && doc.status !== "Processed") return doc.status.toLowerCase();
  if (doc.supersededBy) return "superseded";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const effective = parseDay(doc.effectiveDate);
  if (effective !== null && today < effective) return "upcoming";
  const expiry = parseDay(doc.expiryDate);
  if (expiry !== null && today > expiry) return "expired";
  return "live";
}

export const STATE_LABEL = {
  superseded: "Replaced by a newer version",
  expired: "Expired",
  upcoming: "Not yet in effect",
};
