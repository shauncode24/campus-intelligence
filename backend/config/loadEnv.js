/**
 * Load environment variables. Import this FIRST (before anything that reads
 * process.env).
 *
 * By default it reads backend/.env. To keep secrets out of the project folder
 * (for example when it lives in a OneDrive/Dropbox-synced directory), set the
 * ENV_FILE environment variable to the full path of an env file stored
 * elsewhere. If ENV_FILE is set but the file cannot be read, the process stops
 * instead of silently running without its secrets.
 */
import dotenv from "dotenv";

const envFile = process.env.ENV_FILE;
const result = dotenv.config({ ...(envFile ? { path: envFile } : {}), quiet: true });

if (envFile && result.error) {
  console.error(`ENV_FILE is set to "${envFile}" but it could not be read: ${result.error.message}`);
  process.exit(1);
}
