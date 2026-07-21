import path from "node:path";

import { pruneTinyOfficeBackups } from "../../src/runtime/backup/tinyoffice-backup.js";

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const directory = path.resolve(requiredArgument("--directory"));
const keep = Number(requiredArgument("--keep"));
const result = await pruneTinyOfficeBackups({ directory, keep });

console.log(`Pre-update backup retention kept ${result.kept.length} complete backup pair(s) and removed ${result.removed.length}.`);
if (result.skipped.length > 0) {
  console.warn(`Skipped ${result.skipped.length} incomplete or invalid backup archive(s); no files from those entries were deleted.`);
}
