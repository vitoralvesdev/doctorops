import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST?.trim() || "0.0.0.0";
export const VERSION = "0.6.0";

// src/core em desenvolvimento; app/dist/core no pacote instalado.
const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, "../..");

export const PACKAGED = fs.existsSync(path.join(APP_ROOT, ".packaged")) || process.env.TX_PACKAGED === "1";

function userDataDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "DoctorOps");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "DoctorOps");
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "doctorops");
}

export const DATA_DIR = process.env.TX_DATA_DIR?.trim()
  ? path.resolve(process.env.TX_DATA_DIR.trim())
  : PACKAGED
    ? userDataDir()
    : APP_ROOT;

if (PACKAGED || process.env.TX_DATA_DIR?.trim()) fs.mkdirSync(DATA_DIR, { recursive: true });

export const PUBLIC_DIR = path.join(APP_ROOT, "public");
export const CAPTURES_DIR = path.join(DATA_DIR, "captures");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
export const ROMS_DIR = process.env.TX_ROMS_DIR?.trim() || path.join(DATA_DIR, "roms");
export const BACKUPS_DIR = process.env.TX_BACKUPS_DIR?.trim() || path.join(DATA_DIR, "backups");

const adbName = process.platform === "win32" ? "adb.exe" : "adb";

function bundledAdb(): string | null {
  const candidates = [
    path.resolve(APP_ROOT, "..", "platform-tools", adbName),
    path.join(APP_ROOT, "platform-tools", adbName),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export const ADB_BIN = process.env.TX_ADB?.trim() || bundledAdb() || "adb";
