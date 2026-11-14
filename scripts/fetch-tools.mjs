import { ensureNode, ensurePlatformTools, fail, log, tools } from "./lib.mjs";

const arg = process.argv[2] ?? "--help";
const targets = arg === "--all" ? ["win-x64", "mac-arm64", "mac-x64"] : [arg];

for (const target of targets) {
  if (!["win-x64", "mac-arm64", "mac-x64"].includes(target)) {
    fail("Uso: node scripts/fetch-tools.mjs <win-x64|mac-arm64|mac-x64|--all>");
  }
  await ensureNode(target);
}

const oses = arg === "--all" ? ["win", "darwin"] : [arg === "win-x64" ? "win" : "darwin"];
for (const os of oses) await ensurePlatformTools(os);

log("ok", `Node ${tools.node} e platform-tools ${tools.platformTools.version} prontos em build/cache`);
