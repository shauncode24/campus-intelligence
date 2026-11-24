// Runs every API test in this folder against the real Express app, using the Firestore EMULATOR
// as the database and a stand-in for the Python service (no Firebase project, no Gemini, no
// network). Each file is a stand-alone script that starts the app on its own port, makes real
// HTTP calls and exits non-zero on the first failed check.
//
//   cd firestore-tests && npx firebase emulators:exec --only firestore --project demo-campus-intel \
//       --config ../firebase.json "node ../backend/tests/api/run.mjs"
//
// (or `npm --prefix firestore-tests run test:api`). Requires the emulator's FIRESTORE_EMULATOR_HOST.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is not set: run this through `firebase emulators:exec` (see the top of this file).");
  process.exit(2);
}

// The app builds a Firebase Admin credential at start-up and needs a well-formed private key.
// It is never used to sign anything real (tokens are stubbed), so make a throwaway one per run
// instead of keeping a key in the repository.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const env = {
  ...process.env,
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_CLIENT_EMAIL: "tests@demo-campus-intel.iam.gserviceaccount.com",
  FIREBASE_PROJECT_ID: "demo-campus-intel",
  GOOGLE_API_KEY: "test-not-a-real-key",
};

const only = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && f !== "run.mjs")
  .filter((f) => !only || f.includes(only))
  .sort();

// Every file starts from an empty database: the emulator keeps data between scripts otherwise,
// and tests would depend on the order they run in.
async function clearDatabase() {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-campus-intel/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`could not clear the emulator database: ${res.status}`);
}

let failed = 0;
for (const file of files) {
  await clearDatabase();
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, file)], { env, encoding: "utf8", timeout: 120_000 });
  const lines = (r.stdout || "").split("\n");
  const checks = lines.filter((l) => l.startsWith("PASS ") || l.startsWith("FAIL ")).length;
  const bad = lines.filter((l) => l.startsWith("FAIL "));
  // A script passes when it ran checks, none failed, and it reached its final "ALL PASSED" line.
  // (Not the exit code alone: on Windows, Node can abort while closing handles AFTER a clean run.)
  const ok = bad.length === 0 && checks > 0 && (r.stdout || "").includes("ALL PASSED");
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${checks} checks, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!ok) {
    failed++;
    bad.forEach((l) => console.log("     " + l));
    if (bad.length === 0) console.log((r.stderr || r.stdout || "").split("\n").slice(-12).join("\n"));
  }
}
console.log(failed ? `\n${failed} of ${files.length} API test files failed` : `\nAll ${files.length} API test files passed`);
process.exit(failed ? 1 : 0);
