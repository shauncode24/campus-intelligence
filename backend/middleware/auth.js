import admin from "firebase-admin";
// Importing this module guarantees the default Firebase Admin app is initialised.
import "../config/firebaseAdmin.js";

/**
 * Verify the Firebase ID token (`Authorization: Bearer <token>`).
 * On success sets:
 *   req.uid       - the verified Firebase uid (the ONLY trusted user identity)
 *   req.email     - the verified email, if the account has one
 *   req.claims    - all verified token claims
 *   req.authToken - the raw bearer token, so it can be forwarded to the Python
 *                   RAG service, which verifies it again on its own.
 *
 * Never read a user id from req.body / req.query / req.params for authorisation.
 * Returns true if the request may continue, false if a response was sent.
 */
async function authenticate(req, res) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (!/^Bearer$/i.test(scheme || "") || !token) {
    res.set("WWW-Authenticate", "Bearer");
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return false;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email || null;
    req.claims = decoded;
    req.authToken = token;
    return true;
  } catch (error) {
    // Never log the token itself.
    console.warn(`Auth rejected: ${error.code || error.name}`);
    res.set("WWW-Authenticate", "Bearer");
    res.status(401).json({ error: "Invalid or expired token" });
    return false;
  }
}

/** Require any signed-in Firebase user (including anonymous guests). */
export async function requireAuth(req, res, next) {
  if (await authenticate(req, res)) next();
}

/**
 * Require the Firebase custom claim `admin: true`.
 * The claim can only be granted server-side (backend/scripts/setAdminClaim.js);
 * it is deliberately NOT read from any Firestore document a client can write.
 */
export async function requireAdmin(req, res, next) {
  if (!(await authenticate(req, res))) return;
  if (req.claims.admin !== true) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
