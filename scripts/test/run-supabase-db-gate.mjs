import { constants } from "node:fs";
import { access, copyFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repositoryRoot, "supabase/fixtures/legacy_schema_fixture.sql");
const temporaryMigrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/00000000000000_legacy_schema_fixture.sql",
);

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function runSupabase(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["supabase@2.116.0", ...args], {
      cwd: repositoryRoot,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`supabase ${args.join(" ")} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

if (await exists(temporaryMigrationPath)) {
  throw new Error(
    `Refusing to overwrite ${path.relative(repositoryRoot, temporaryMigrationPath)}; remove or review it first.`,
  );
}

await copyFile(fixturePath, temporaryMigrationPath, constants.COPYFILE_EXCL);

try {
  await runSupabase(["start"]);
  await runSupabase(["db", "reset", "--local"]);
  await runSupabase(["test", "db", "--local"]);
  await runSupabase(["db", "advisors", "--local", "--type", "all", "--level", "warn", "--fail-on", "warn"]);
  await runSupabase([
    "db", "lint", "--local", "--schema", "public,publisher_private",
    "--level", "warning", "--fail-on", "error",
  ]);
} finally {
  await unlink(temporaryMigrationPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}
