/**
 * Removal of an uploaded file from the Supabase storage bucket.
 *
 * Needs a server-side key with delete rights (SUPABASE_SERVICE_ROLE_KEY in
 * backend/.env). That key must NEVER be sent to the browser. If it is not
 * configured the file is left in place and the caller is told so; deleting a
 * document must not hang on this.
 */
import { validateFileUrl } from "../utils/fileUrl.js";

const PUBLIC_PREFIX = "/storage/v1/object/public/documents/";
const TIMEOUT_MS = 15000;

/**
 * @param {string} fileUrl the stored public URL of the document
 * @returns {Promise<{ deleted: boolean, reason?: string }>}
 */
export async function deleteDocumentFile(fileUrl) {
  // Only ever call storage for URLs that point at our own bucket.
  const check = validateFileUrl(fileUrl);
  if (!check.ok) {
    return { deleted: false, reason: `Stored file URL not recognised (${check.reason})` };
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return {
      deleted: false,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not configured; the file was left in storage",
    };
  }

  const url = new URL(fileUrl);
  const objectPath = url.pathname.slice(PUBLIC_PREFIX.length); // still percent-encoded
  const target = `${url.origin}/storage/v1/object/documents/${objectPath}`;

  try {
    const response = await fetch(target, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 404 = already gone, which is the state we want
    if (response.ok || response.status === 404) return { deleted: true };
    return { deleted: false, reason: `Storage returned HTTP ${response.status}` };
  } catch (error) {
    return { deleted: false, reason: `Storage request failed (${error.name})` };
  }
}
