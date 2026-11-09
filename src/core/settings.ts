import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = 3000;
export const HOST = process.env.HOST?.trim() || "0.0.0.0";
export const VERSION = "0.6.0";
const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, "../..");

export const PUBLIC_DIR = path.join(DATA_DIR, "public");
export const CAPTURES_DIR = path.join(DATA_DIR, "captures");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
