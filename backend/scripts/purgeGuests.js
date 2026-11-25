/**
 * Erase guest accounts (and their data) that have not been used for a while.
 *
 *   node scripts/purgeGuests.js --dry-run          # only report
 *   node scripts/purgeGuests.js --days 90          # default is 60
 *
 * Uses the same service-account env vars as the API. Signed-up accounts are never touched.
 */
import admin from "firebase-admin";
import { db } from "../config/firebaseAdmin.js";
import { purgeInactiveGuests } from "../services/guestPurge.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysAt = args.indexOf("--days");
const maxAgeDays = daysAt >= 0 ? Number(args[daysAt + 1]) : 60;

try {
  const result = await purgeInactiveGuests({ auth: admin.auth(), db, maxAgeDays, dryRun });
  console.log(`${dryRun ? "[dry run] " : ""}scanned ${result.scanned} accounts: ${result.guests} guests, ` +
    `${dryRun ? "would erase" : "erased"} ${result.purged}, kept ${result.kept}`);
  process.exit(0);
} catch (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
