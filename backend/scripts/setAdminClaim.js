/**
 * Grant or revoke the `admin` custom claim on a Firebase user.
 *
 *   node scripts/setAdminClaim.js admin@example.com          # grant
 *   node scripts/setAdminClaim.js admin@example.com --revoke # revoke
 *
 * Uses the same service-account env vars as the API (backend/.env).
 * The user must sign out and back in (or refresh their ID token) before the
 * new claim appears in their token.
 */
import admin from "firebase-admin";
import "../config/firebaseAdmin.js";

const [email, flag] = process.argv.slice(2);

if (!email || email.startsWith("--")) {
  console.error("Usage: node scripts/setAdminClaim.js <email> [--revoke]");
  process.exit(1);
}

try {
  const user = await admin.auth().getUserByEmail(email);
  const revoke = flag === "--revoke";

  // Preserve any other custom claims the user already has.
  const claims = { ...(user.customClaims || {}) };
  if (revoke) {
    delete claims.admin;
  } else {
    claims.admin = true;
  }
  await admin.auth().setCustomUserClaims(user.uid, claims);

  console.log(
    `${revoke ? "Revoked" : "Granted"} admin for ${email} (uid ${user.uid}). ` +
      "They must sign in again for it to take effect."
  );
  process.exit(0);
} catch (error) {
  console.error(`Failed: ${error.code || error.message}`);
  process.exit(1);
}
