// Pure helpers for the admin upload form (no React, no imports, so they can be tested with
// `node --test frontend/src/utils`).

export const MAX_FILES = 20;
export const MAX_BYTES = 50 * 1024 * 1024; // the server's default PDF limit (MAX_PDF_BYTES)

/**
 * A stable identity for a selected file. The name alone is NOT one: two different files in
 * different folders can share a name.
 */
export function fileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
}

/** A PDF by extension, and by type when the browser reports one (it sometimes reports none). */
export function isPdf(file) {
  const byName = /\.pdf$/i.test(file.name || "");
  const byType = !file.type || file.type === "application/pdf";
  return byName && byType;
}

/**
 * Decide which of the `incoming` files can join the `existing` selection.
 * Returns { accepted: File[], rejected: [{ name, reason }] }. Never throws; every file is
 * accounted for so the admin is told why something was left out.
 */
export function validateSelection(
  existing,
  incoming,
  { maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {}
) {
  const accepted = [];
  const rejected = [];
  const seen = new Set(existing.map(fileKey));

  for (const file of incoming) {
    if (!isPdf(file)) {
      rejected.push({ name: file.name, reason: "Not a PDF file" });
    } else if (!file.size) {
      rejected.push({ name: file.name, reason: "The file is empty" });
    } else if (file.size > maxBytes) {
      rejected.push({
        name: file.name,
        reason: `Larger than ${Math.round(maxBytes / (1024 * 1024))} MB`,
      });
    } else if (seen.has(fileKey(file))) {
      rejected.push({ name: file.name, reason: "Already selected" });
    } else if (existing.length + accepted.length >= maxFiles) {
      rejected.push({ name: file.name, reason: `Only ${maxFiles} files at a time` });
    } else {
      seen.add(fileKey(file));
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** SHA-256 of a file's bytes as lowercase hex. Used to spot the exact same file uploaded twice. */
export async function sha256Hex(file, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  if (!subtle) return null; // e.g. an insecure (http) page: the check is skipped, not faked
  const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Call `fn` only after `ms` of quiet. `.cancel()` drops a pending call. */
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}
