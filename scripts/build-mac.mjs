import fs from "node:fs";
import path from "node:path";
import { stage } from "./stage.mjs";
import { copyTree, fail, log, outDir, readVersion, root, run } from "./lib.mjs";

if (process.platform !== "darwin") {
  fail("O .dmg só pode ser gerado no macOS (ou no GitHub Actions, runner macos-14).");
}

const version = readVersion();
const stageDir = await stage("mac");
const buildDir = path.join(root, "build", "mac");
const appName = "DoctorOps.app";
const appDir = path.join(buildDir, "dmg", appName);
const contents = path.join(appDir, "Contents");
const resources = path.join(contents, "Resources");

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });

log("mac", "montando bundle .app");
copyTree(path.join(stageDir, "app"), path.join(resources, "app"));
copyTree(path.join(stageDir, "runtime"), path.join(resources, "runtime"));
copyTree(path.join(stageDir, "platform-tools"), path.join(resources, "platform-tools"));

const launcher = path.join(contents, "MacOS", "launcher");
fs.copyFileSync(path.join(root, "packaging", "macos", "launcher.sh"), launcher);
fs.chmodSync(launcher, 0o755);
const runner = path.join(resources, "run-server.command");
fs.copyFileSync(path.join(root, "packaging", "macos", "run-server.command"), runner);
fs.chmodSync(runner, 0o755);
fs.chmodSync(path.join(resources, "runtime", "node-arm64"), 0o755);
fs.chmodSync(path.join(resources, "runtime", "node-x64"), 0o755);
fs.chmodSync(path.join(resources, "platform-tools", "adb"), 0o755);

const info = fs
  .readFileSync(path.join(root, "packaging", "macos", "Info.plist"), "utf8")
  .replaceAll("{{VERSION}}", version);
fs.writeFileSync(path.join(contents, "Info.plist"), info);

const iconPng = path.join(root, "packaging", "icons", "app.png");
if (fs.existsSync(iconPng)) {
  try {
    const iconset = path.join(buildDir, "app.iconset");
    fs.mkdirSync(iconset, { recursive: true });
    const variants = [
      [16, "icon_16x16.png"],
      [32, "icon_16x16@2x.png"],
      [32, "icon_32x32.png"],
      [64, "icon_32x32@2x.png"],
      [128, "icon_128x128.png"],
      [256, "icon_128x128@2x.png"],
      [256, "icon_256x256.png"],
      [512, "icon_256x256@2x.png"],
      [512, "icon_512x512.png"],
      [1024, "icon_512x512@2x.png"],
    ];
    for (const [size, name] of variants) {
      run("sips", ["-z", String(size), String(size), iconPng, "--out", path.join(iconset, name)]);
    }
    run("iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "app.icns")]);
    log("mac", "ícone gerado");
  } catch {
    log("mac", "aviso: não foi possível gerar o .icns (segue com o ícone padrão)");
  }
}

log("mac", "assinatura ad-hoc");
try {
  run("codesign", ["--force", "--deep", "--sign", "-", appDir]);
} catch {
  log("mac", "aviso: codesign falhou; o app ainda abre com clique-direito > Abrir");
}

const dmgRoot = path.join(buildDir, "dmg");
fs.symlinkSync("/Applications", path.join(dmgRoot, "Applications"));

fs.mkdirSync(outDir, { recursive: true });
const dmg = path.join(outDir, `DoctorOps-${version}-universal.dmg`);
fs.rmSync(dmg, { force: true });
log("mac", "gerando .dmg");
run("hdiutil", [
  "create",
  "-volname",
  "DoctorOps",
  "-srcfolder",
  dmgRoot,
  "-ov",
  "-format",
  "UDZO",
  dmg,
]);

log("ok", `dmg gerado: ${dmg}`);
