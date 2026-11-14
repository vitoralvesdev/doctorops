import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const tools = JSON.parse(fs.readFileSync(path.join(root, "packaging", "tools.json"), "utf8"));
export const cacheDir = path.join(root, "build", "cache");
export const stageRoot = path.join(root, "build", "stage");
export const outDir = path.join(root, "dist-installers");

export function log(step, message) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${message}`);
}

export function fail(message) {
  console.error(`\x1b[31m[erro]\x1b[0m ${message}`);
  process.exit(1);
}

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

export function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo);
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function verify(file, algo, expected) {
  const actual = await hashFile(file, algo);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fs.rmSync(file, { force: true });
    fail(`Checksum inválido para ${path.basename(file)}: esperado ${expected}, obtido ${actual}`);
  }
}

export async function download(url, dest, algo, expected) {
  if (fs.existsSync(dest)) {
    await verify(dest, algo, expected);
    log("cache", `${path.basename(dest)} já baixado`);
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log("baixar", url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) fail(`Falha ao baixar ${url}: HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  await verify(dest, algo, expected);
  return dest;
}

export function extract(archive, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // Git Bash pode colocar o GNU tar no PATH, que trata "C:" como host remoto.
  const sysTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (process.platform === "win32" && fs.existsSync(sysTar)) {
    run(sysTar, ["-xf", archive, "-C", dest]);
  } else {
    run("tar", ["-xf", archive, "-C", dest]);
  }
  return dest;
}

export async function nodeShasums(version) {
  const res = await fetch(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`);
  if (!res.ok) fail(`Falha ao baixar SHASUMS256.txt do Node v${version}`);
  const text = await res.text();
  const map = new Map();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

const NODE_ARCHIVE = {
  "win-x64": (v) => `node-v${v}-win-x64.zip`,
  "mac-arm64": (v) => `node-v${v}-darwin-arm64.tar.gz`,
  "mac-x64": (v) => `node-v${v}-darwin-x64.tar.gz`,
};

export async function ensureNode(target) {
  const version = tools.node;
  const file = NODE_ARCHIVE[target](version);
  if (!file) fail(`Alvo de Node desconhecido: ${target}`);
  const shasums = await nodeShasums(version);
  const expected = shasums.get(file);
  if (!expected) fail(`Checksum de ${file} não encontrado no SHASUMS256.txt`);
  const archive = await download(`https://nodejs.org/dist/v${version}/${file}`, path.join(cacheDir, "node", file), "sha256", expected);
  const dir = extract(archive, path.join(cacheDir, "node", target));
  const folder = file.replace(/\.(zip|tar\.gz)$/, "");
  const candidates = [path.join(dir, folder, "node.exe"), path.join(dir, folder, "bin", "node")];
  const bin = candidates.find((p) => fs.existsSync(p));
  if (!bin) fail(`Binário do Node não encontrado em ${dir}`);
  log("node", `${target} ${version}`);
  return bin;
}

export async function ensurePlatformTools(os) {
  const meta = tools.platformTools[os];
  if (!meta) fail(`Platform tools desconhecido para ${os}`);
  const file = path.basename(new URL(meta.url).pathname);
  const archive = await download(meta.url, path.join(cacheDir, "platform-tools", file), "sha1", meta.sha1);
  const dir = extract(archive, path.join(cacheDir, "platform-tools", os));
  const adb = path.join(dir, "platform-tools", os === "win" ? "adb.exe" : "adb");
  if (!fs.existsSync(adb)) fail(`adb não encontrado em ${dir}`);
  log("platform-tools", `${os} ${tools.platformTools.version}`);
  return path.join(dir, "platform-tools");
}

export function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return dest;
}

// fs.cpSync derruba o processo em Node 22 no Windows (OneDrive); cópia manual é estável.
export function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to);
  }
  return dest;
}

export function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
}

export function hasCommand(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
