import { Pool } from "pg";

const confirmation = process.argv.slice(2).join(" ");
if (confirmation !== "--confirm RESET-OWNER-AUTH") {
  throw new Error("Recovery is destructive. Re-run with: npm run auth:reset-owner -- --confirm RESET-OWNER-AUTH");
}

const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim()
  || "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice?sslmode=disable";
const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query("BEGIN");
  const passkeys = await pool.query("DELETE FROM auth_passkeys");
  const sessions = await pool.query("DELETE FROM auth_sessions");
  await pool.query("COMMIT");
  console.log(`Owner authentication reset: ${passkeys.rowCount ?? 0} passkey(s), ${sessions.rowCount ?? 0} session(s) removed.`);
  console.log("Restart TinyOffice and use the new one-time Owner setup URL printed in the terminal.");
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
