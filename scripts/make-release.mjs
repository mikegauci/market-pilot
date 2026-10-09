import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git failed").trim());
  return (result.stdout || "").trim();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function bump(current, kind) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function main() {
  if (git(["branch", "--show-current"]) !== "release") {
    throw new Error("Check out the release branch before making a release.");
  }
  if (git(["status", "--porcelain"])) {
    throw new Error("Commit your changes before making a release.");
  }
  const skipDrift = process.argv.includes("--skip-drift");
  if (!skipDrift) {
    const check = spawnSync("node", ["scripts/dump-schema.mjs"], { cwd: root, stdio: "inherit" });
    if (check.status === 2) {
      throw new Error("The drift check needs SUPABASE_DB_URL. Set it, or re-run with --skip-drift.");
    }
    if (check.status !== 0) {
      throw new Error("The live database does not match supabase/migrations. Add the missing SQL as a new migration file.");
    }
  }
  const current = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  const alreadyTagged = git(["tag", "-l", `v${current}`]);
  let next = current;
  if (alreadyTagged) {
    const kind = (await ask(`v${current} is already published. Type patch, minor, or major [patch]: `)) || "patch";
    next = bump(current, kind);
    fs.writeFileSync(path.join(root, "VERSION"), `${next}\n`);
    git(["add", "VERSION"]);
    git(["commit", "-m", `Release ${next}.`]);
  }
  const notes = await ask(`What should friends see about version ${next}? `);
  const zip = path.join(root, `market-pilot-v${next}.zip`);
  const archive = spawnSync("git", [
    "archive",
    "--format=zip",
    "--prefix=market-pilot/",
    "-o",
    zip,
    "HEAD",
    "--",
    ".",
    ":(exclude).cursor",
    ":(exclude).agents",
    ":(exclude)CLAUDE.md",
    ":(exclude)supabase/migrations-archive",
  ], { cwd: root });
  if (archive.status !== 0) throw new Error("Could not build the zip.");
  git(["tag", `v${next}`]);
  git(["push", "origin", "release", `v${next}`]);
  const published = spawnSync("gh", [
    "release",
    "create",
    `v${next}`,
    zip,
    "--title",
    `Market Pilot ${next}`,
    "--notes",
    notes || `Version ${next}`,
    "--target",
    "release",
  ], { cwd: root, stdio: "inherit" });
  if (published.status !== 0) throw new Error("The zip was built, but GitHub did not publish the release.");
  fs.rmSync(zip, { force: true });
  console.log(`\nPublished v${next}. Friends will see it the next time they double-click Start.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
