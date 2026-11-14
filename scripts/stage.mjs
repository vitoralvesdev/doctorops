import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyFile,
  copyTree,
  ensureNode,
  ensurePlatformTools,
  fail,
  log,
  root,
  run,
  stageRoot,
  tools,
} from "./lib.mjs";

export const TARGETS = {
  "win-x64": {
    platform: "win32",
    node: "win-x64",
    tools: "win",
    platformToolsFiles: ["adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll", "source.properties"],
  },
  mac: {
    platform: "darwin",
    node: ["mac-arm64", "mac-x64"],
    tools: "darwin",
    platformToolsFiles: ["adb", "source.properties"],
  },
};

function tsc(outDir) {
  const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tscBin, "-p", path.join(root, "tsconfig.json"), "--outDir", outDir], { cwd: root });
}

function prodDeps(appDir) {
  fs.copyFileSync(path.join(root, "package-lock.json"), path.join(appDir, "package-lock.json"));
  log("npm", "instalando dependências de produção");
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: appDir,
    shell: process.platform === "win32",
  });
}

export async function stage(target) {
  const spec = TARGETS[target];
  if (!spec) fail(`Alvo desconhecido: ${target}`);
  if (process.platform !== spec.platform) {
    fail(`Este alvo precisa ser gerado em ${spec.platform}. Rode no GitHub Actions ou numa máquina ${spec.platform}.`);
  }

  const stageDir = path.join(stageRoot, target);
  const appDir = path.join(stageDir, "app");
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  log("build", "compilando TypeScript");
  tsc(path.join(appDir, "dist"));

  log("build", "copiando interface");
  copyTree(path.join(root, "public"), path.join(appDir, "public"));

  fs.copyFileSync(path.join(root, "package.json"), path.join(appDir, "package.json"));
  fs.writeFileSync(path.join(appDir, ".packaged"), "");
  prodDeps(appDir);
  fs.rmSync(path.join(appDir, "package-lock.json"), { force: true });

  log("build", `empacotando Node ${tools.node}`);
  if (Array.isArray(spec.node)) {
    for (const arch of spec.node) {
      const nodeBin = await ensureNode(arch);
      const dest = copyFile(nodeBin, path.join(stageDir, "runtime", arch === "mac-arm64" ? "node-arm64" : "node-x64"));
      fs.chmodSync(dest, 0o755);
    }
  } else {
    copyFile(await ensureNode(spec.node), path.join(stageDir, "runtime", "node.exe"));
  }

  const ptDir = await ensurePlatformTools(spec.tools);
  for (const file of spec.platformToolsFiles) {
    const src = path.join(ptDir, file);
    if (!fs.existsSync(src)) fail(`Arquivo não encontrado: ${src}`);
    const dest = copyFile(src, path.join(stageDir, "platform-tools", file));
    if (spec.tools === "darwin") fs.chmodSync(dest, file === "adb" ? 0o755 : 0o644);
  }

  const icon = path.join(root, "packaging", "icons", "app.ico");
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(stageDir, "app.ico"));

  log("build", `stage pronto: ${stageDir}`);
  return stageDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = process.argv[2];
  if (!target) fail("Uso: node scripts/stage.mjs <win-x64|mac>");
  await stage(target);
}
