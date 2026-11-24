// Turning the model's citations into real links, and a few small display helpers.
// Pure functions with no imports, so they can be tested with `node --test`.

/** "https://host/file.pdf" + page 3 -> "https://host/file.pdf#page=3" (the PDF viewer jumps there) */
export function pageLink(source) {
  const url = source && source.fileUrl;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  const page = source.displayPage;
  return Number.isInteger(page) && page > 0 ? `${url.split("#")[0]}#page=${page}` : url;
}

const normalise = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// "[Fee Policy, p. 2]" or "[Fee Policy, version v2, effective 2025-01-01, p. 2]"
const CITATION = /\[([^[\]]+?),\s*p(?:age|p?\.)?\s*(\d+)\]/gi;

/**
 * Link each citation the model wrote to the page it names, but only when it really matches one
 * of this answer's sources (same document, same page). An unmatched citation is left exactly as
 * written: a link is never invented.
 */
export function linkCitations(text, sources) {
  if (!text || !Array.isArray(sources) || sources.length === 0) return text || "";
  return text.replace(CITATION, (whole, name, pageText) => {
    const page = Number(pageText);
    const wanted = normalise(name);
    const hit = sources.find(
      (s) =>
        s &&
        s.displayPage === page &&
        pageLink(s) &&
        s.documentName &&
        (wanted === normalise(s.documentName) || wanted.startsWith(normalise(s.documentName) + ","))
    );
    if (!hit) return whole;
    const url = pageLink(hit).replace(/\(/g, "%28").replace(/\)/g, "%29");
    return `[[${name.trim()}, p. ${page}]](${url})`;
  });
}

/** One entry per (document, page, kind): the same page retrieved twice is listed once. */
export function uniqueSources(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources || []) {
    const key = `${s.documentId}|${s.displayPage ?? s.pageNumber}|${s.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/** "just now", "5 minutes ago", "3 days ago" */
export function ageLabel(thenMs, nowMs = Date.now()) {
  if (!Number.isFinite(thenMs)) return null;
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 60) return "just now";
  const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86400), "day");
}

export const FEEDBACK_REASONS = [
  { id: "wrong", label: "Wrong answer" },
  { id: "missing", label: "It's in the documents, but not found" },
  { id: "outdated", label: "Out of date" },
  { id: "unclear", label: "Unclear" },
  { id: "other", label: "Something else" },
];
