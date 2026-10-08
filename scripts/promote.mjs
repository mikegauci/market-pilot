import { spawnSync } from "node:child_process";
import readline from "node:readline";

function git(args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFail) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
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

async function main() {
  git(["rev-parse", "--verify", "release"]);
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    throw new Error("Commit or stash your changes on main before promoting. The working tree is not clean.");
  }
  const current = git(["branch", "--show-current"]);
  if (current !== "main") {
    throw new Error("Check out main first, then run this.");
  }
  const list = git(["log", "--reverse", "--oneline", "release..main"]);
  if (!list) {
    console.log("release already has everything that is on main.");
    return;
  }
  const commits = list.split("\n").filter(Boolean);
  console.log("\nCommits on main that friends do not have yet:\n");
  commits.forEach((line, index) => console.log(`  ${index + 1}. ${line}`));
  const answer = await ask("\nType the numbers to share, separated by spaces, or 'all': ");
  const chosen = answer === "all"
    ? commits
    : answer.split(/\s+/).map((item) => commits[Number(item) - 1]).filter(Boolean);
  if (chosen.length === 0) {
    console.log("Nothing selected. Database migration files will still be copied if main has new ones.");
  }
  git(["checkout", "release"]);
  try {
    for (const line of chosen) {
      const sha = line.split(" ")[0];
      console.log(`\nCopying ${line}`);
      git(["cherry-pick", sha]);
    }
    const migrationDiff = git(["diff", "--name-only", "HEAD", "main", "--", "supabase/migrations", "supabase/seed.sql"]);
    if (migrationDiff) {
      console.log("\nCopying database files from main so friends stay on the same database version.");
      git(["checkout", "main", "--", "supabase/migrations", "supabase/seed.sql"]);
      const staged = git(["status", "--porcelain", "--", "supabase/migrations", "supabase/seed.sql"]);
      if (staged) {
        git(["commit", "-m", "Sync database migrations from main."]);
      }
    }
  } catch (error) {
    console.error(`\n${error.message}`);
    console.error("You are on the release branch. Fix the conflict, then run git cherry-pick --continue, or git cherry-pick --abort and git checkout main.");
    process.exit(1);
  }
  git(["checkout", "main"]);
  console.log("\nThose commits are on release. Push it, then run node scripts/make-release.mjs");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
