import fs from "node:fs";
import path from "node:path";
import { root, say } from "./lib.mjs";

const pidPath = path.join(root, "logs", "trader.pid");

function main() {
  if (!fs.existsSync(pidPath)) {
    say("The trader is not running.");
    return;
  }
  const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  try {
    process.kill(pid);
    say("The trader has stopped. Your dashboard stays online and will show the bot as offline.");
  } catch {
    say("The trader was already stopped.");
  }
  fs.rmSync(pidPath, { force: true });
}

main();
