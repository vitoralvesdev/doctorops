import fs from "node:fs";
import path from "node:path";
import { stage } from "./stage.mjs";
import { fail, hasCommand, log, outDir, readVersion, root, run } from "./lib.mjs";

if (process.platform !== "win32") {
  fail("O instalador do Windows só pode ser gerado no Windows (ou no GitHub Actions).");
}

function findIscc() {
  const candidates = [
    process.env.ISCC,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Inno Setup 6", "ISCC.exe"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? (hasCommand("ISCC") ? "ISCC.exe" : null);
}

const iscc = findIscc();
if (!iscc) {
  fail(
    "Inno Setup 6 não encontrado. Instale com:\n" +
      "  winget install -e --id JRSoftware.InnoSetup\n" +
      "ou baixe https://jrsoftware.org/isdl.php e marque a instalação por usuário.",
  );
}

const stageDir = await stage("win-x64");
fs.mkdirSync(outDir, { recursive: true });
const version = readVersion();
log("inno", `compilando instalador ${version}`);
run(iscc, [
  `/DAppVersion=${version}`,
  `/DStageDir=${stageDir}`,
  `/DOutputDir=${outDir}`,
  `/DIconFile=${path.join(root, "packaging", "icons", "app.ico")}`,
  path.join(root, "packaging", "windows", "setup.iss"),
]);

const setup = path.join(outDir, `DoctorOps-${version}-setup.exe`);
if (!fs.existsSync(setup)) fail("O Inno Setup não gerou o instalador esperado.");
log("ok", `instalador gerado: ${setup}`);
