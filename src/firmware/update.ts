import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { run, runBuffer } from "../adb/client.js";
import type { DeviceTarget } from "../adb/ops.js";
import { BACKUPS_DIR, ROMS_DIR } from "../core/settings.js";
import { delay } from "../core/time.js";
import {
  findInnerImage,
  readSlice,
  streamInner,
  zipDirectory,
  type InnerFile,
  type ZipEntry,
} from "./archive.js";

const ROM_EXTENSIONS = [".img", ".zip", ".rar"];
const CRITICAL_PARTITIONS = ["bootloader", "env", "boot", "recovery", "misc", "vbmeta", "vbmeta_system", "vbmeta_vendor"];
const UPDATER_PACKAGE = "com.softwinner.update";
const UPDATER_ACTIVITY = `${UPDATER_PACKAGE}/com.softwinner.shared.LocalVerifyActivity`;
const REMOTE_DIR = "/sdcard/Download";
const PHOENIX_TOOLS = [
  "C:\\Program Files\\PhoenixSuit\\PhoenixSuit.exe",
  "C:\\Program Files (x86)\\PhoenixSuit\\PhoenixSuit.exe",
  "C:\\Program Files\\PhoenixCard\\PhoenixCard.exe",
  "C:\\Program Files (x86)\\PhoenixCard\\PhoenixCard.exe",
  "C:\\Program Files\\Allwinner\\PhoenixSuit\\PhoenixSuit.exe",
  "C:\\Program Files (x86)\\Allwinner\\PhoenixSuit\\PhoenixSuit.exe",
];

const MARKER_RE =
  /IMAGEWTY|RFSFAT16|google\/[a-z0-9_.]+\/[a-z0-9_.]+|sun50iw\d+[a-z0-9]*|Transpeed_H616-[A-Za-z0-9._-]+|Transpeed[_ -]?H?\d+|\bH6(?:16|18)?\b|\bH313\b|ren@[A-Za-z0-9._-]+|eng\.[A-Za-z0-9._-]+|ro\.fota\.version[=:]\s*[^\s\x00]{1,80}|ro\.build\.fingerprint[=:]\s*[^\s\x00]{1,160}|20[12]\d{5}/gi;

export type RomInfo = {
  name: string;
  path: string;
  size: number;
  mtime: Date;
  container?: "zip" | "rar";
  inner?: InnerFile;
};

type RomKind = "ota" | "phoenix" | "card" | "archive" | "unknown";

type ImageReport = {
  info: RomInfo;
  kind: RomKind;
  sha256: string;
  contentSize: number;
  inner: InnerFile | null;
  magic: string | null;
  header: Map<string, string>;
  entries: string[];
  markers: Map<string, string[]>;
  soc: "sun50iw9" | "sun50iw6" | "unknown";
  socEvidence: string[];
  fingerprint: string | null;
  pixelIdentity: boolean;
  stockIdentity: boolean;
  build: string | null;
  author: string | null;
  zipSigned: boolean;
  zipDevice: string | null;
  zipAb: boolean;
  zipPayload: string[];
  zipInner: string[];
};

type RomKit = { dir: string; lines: string[] };

type TargetInfo = {
  root: boolean;
  props: Map<string, string>;
  partitions: string[];
  emmcBytes: number | null;
  availableBytes: number | null;
  updater: boolean;
};

type Verdict = { level: "ok" | "warn" | "block"; lines: string[] };

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "?";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function fmtDate(d: Date): string {
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function sq(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "box";
}

function readZipEntry(file: string, entry: ZipEntry): string | null {
  const header = readSlice(file, entry.offset, 30);
  if (header.length < 30 || header.readUInt32LE(0) !== 0x04034b50) return null;
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const data = readSlice(file, entry.offset + 30 + nameLength + extraLength, entry.compressed);
  try {
    if (entry.method === 0) return data.toString("utf8");
    if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 32 * 1024 * 1024 }).toString("utf8");
  } catch {
    return null;
  }
  return null;
}

function isOtaZip(entries: ZipEntry[]): boolean {
  return entries.some((e) =>
    /^META-INF\/com\/google\/android\/(update-binary|updater-script)$/i.test(e.name),
  ) || entries.some((e) => /(^|\/)payload\.bin$/i.test(e.name));
}

function detectKind(rom: RomInfo): RomKind {
  const ext = path.extname(rom.path).toLowerCase();
  if (ext === ".img") {
    const head = readSlice(rom.path, 0, 64 * 1024);
    if (head.includes(Buffer.from("IMAGEWTY", "latin1"))) return "phoenix";
    if (head.includes(Buffer.from("RFSFAT16", "latin1"))) return "card";
    return "unknown";
  }
  if (ext === ".zip") {
    const zip = zipDirectory(rom.path);
    if (!zip) return "unknown";
    if (isOtaZip(zip.entries)) return "ota";
    return rom.inner ? "archive" : "unknown";
  }
  if (ext === ".rar") return rom.inner ? "archive" : "unknown";
  return "unknown";
}

async function sh(device: DeviceTarget, cmd: string, timeout = 12000, root = false): Promise<string> {
  const full = root ? `su 0 sh -c ${sq(cmd)}` : cmd;
  return run("adb", ["-s", device.endpoint, "shell", full], timeout);
}

function pushMarker(markers: Map<string, string[]>, key: string, value: string): void {
  const list = markers.get(key) ?? [];
  if (list.length < 6 && !list.includes(value)) list.push(value);
  markers.set(key, list);
}

function classifyMarker(markers: Map<string, string[]>, raw: string): void {
  const value = raw.trim();
  if (!value) return;
  if (/^(IMAGEWTY|RFSFAT16)$/i.test(value)) pushMarker(markers, "magic", value.toUpperCase());
  else if (/^google\//i.test(value)) pushMarker(markers, "fingerprint", value);
  else if (/^sun50iw/i.test(value)) pushMarker(markers, "soc", value);
  else if (/^H6(?:16|18)?$|^H313$/i.test(value)) pushMarker(markers, "soc", value.toUpperCase());
  else if (/^Transpeed_H616-/i.test(value)) pushMarker(markers, "build", value);
  else if (/^Transpeed/i.test(value)) pushMarker(markers, "model", value);
  else if (/^ren@|^eng\./i.test(value)) pushMarker(markers, "author", value);
  else if (/^ro\.fota\.version/i.test(value)) pushMarker(markers, "fota", value.replace(/^ro\.fota\.version[=:]\s*/, ""));
  else if (/^ro\.build\.fingerprint/i.test(value)) pushMarker(markers, "fingerprint", value.replace(/^ro\.build\.fingerprint[=:]\s*/, ""));
  else if (/^20[12]\d{5}$/.test(value)) pushMarker(markers, "date", value);
}

async function inspectImage(info: RomInfo): Promise<ImageReport> {
  const hash = crypto.createHash("sha256");
  const markers = new Map<string, string[]>();
  const zip = info.container === "zip" ? zipDirectory(info.path) : null;
  const otaZip = Boolean(zip && isOtaZip(zip.entries));
  const inner = otaZip ? null : (info.inner ?? (info.container ? await findInnerImage(info.path, info.container) : null));

  const headParts: Buffer[] = [];
  let headBytes = 0;
  let contentSize = 0;
  let carry = "";
  const feed = (chunk: Buffer): void => {
    hash.update(chunk);
    contentSize += chunk.length;
    if (headBytes < 256 * 1024) {
      const take = chunk.subarray(0, Math.min(chunk.length, 256 * 1024 - headBytes));
      headParts.push(take);
      headBytes += take.length;
    }
    const text = carry + chunk.toString("latin1");
    for (const match of text.matchAll(MARKER_RE)) classifyMarker(markers, match[0]);
    carry = text.slice(-256);
  };

  if (inner) {
    await streamInner(inner, info.path, feed);
  } else {
    const handle = await fs.promises.open(info.path, "r");
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    try {
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        feed(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
    } finally {
      await handle.close();
    }
  }

  const head = Buffer.concat(headParts).toString("latin1");
  const kind: RomKind = inner
    ? head.includes("IMAGEWTY")
      ? "phoenix"
      : head.includes("RFSFAT16")
        ? "card"
        : "archive"
    : detectKind(info);

  const header = new Map<string, string>();
  for (const line of head.matchAll(/^([A-Za-z0-9_.]{2,40})=([^\x00-\x08\x0b\x0c\x0e-\x1f\r\n]{1,200})/gm)) {
    if (header.size < 40) header.set(line[1], line[2].trim());
  }
  const entries: string[] = [];
  for (const match of head.matchAll(/\b([A-Za-z0-9_.-]{2,48}\.(?:img|fex|bin|dtb|dtbo|txt))\b/gi)) {
    if (entries.length >= 40) break;
    if (!entries.includes(match[1])) entries.push(match[1]);
  }

  const socValues = [...(markers.get("soc") ?? [])];
  const compatible = socValues.some((v) => /sun50iw9|^H61[68]$/i.test(v));
  const conflict = socValues.some((v) => /sun50iw6|^H6$/i.test(v));
  const soc: ImageReport["soc"] = compatible ? "sun50iw9" : conflict ? "sun50iw6" : "unknown";

  const fingerprints = markers.get("fingerprint") ?? [];
  const fpValue = fingerprints.find((v) => !/^google\//i.test(v)) ?? null;
  const pixelIdentity = fingerprints.some((v) => /sailfish/i.test(v));
  const models = markers.get("model") ?? [];
  const stockIdentity = models.some((v) => /Transpeed_H616/i.test(v)) && !pixelIdentity;
  const build = (markers.get("build") ?? markers.get("fota") ?? [])[0] ?? null;
  const author = (markers.get("author") ?? [])[0] ?? null;

  let zipSigned = false;
  let zipDevice: string | null = null;
  let zipAb = false;
  let zipPayload: string[] = [];
  let zipInner: string[] = [];
  if (inner) {
    zipInner = [inner.name];
  } else if (zip) {
    zipInner = [...new Set(zip.entries.map((e) => e.name))].filter((name) => /\.img$/i.test(name)).slice(0, 4);
    zipSigned = zip.signed;
    zipAb = zip.entries.some((e) => /(^|\/)payload\.bin$/i.test(e.name));
    zipPayload = [...new Set(zip.entries.map((e) => e.name))]
      .filter((name) =>
        /(^|\/)(payload\.bin|system\.new\.dat(\.br)?|vendor\.new\.dat(\.br)?|product\.new\.dat(\.br)?|system\.transfer\.list|vendor\.transfer\.list|product\.transfer\.list|care_map\.pb|compatibility\.zip|dynamic_partitions_info\.txt)$/i.test(
          name,
        ) || /^META-INF\/com\/android\/metadata$/i.test(name),
      )
      .slice(0, 8);
    const script = zip.entries.find((e) => /^META-INF\/com\/google\/android\/updater-script$/i.test(e.name));
    if (script) {
      const text = readZipEntry(info.path, script) ?? "";
      const devices = new Set<string>();
      for (const match of text.matchAll(/ro\.product\.(?:device|name)"\s*\)\s*==\s*"([^"]+)"/g)) devices.add(match[1]);
      if (devices.size) zipDevice = [...devices].join(" / ");
    }
  }

  return {
    info,
    kind,
    sha256: hash.digest("hex"),
    contentSize,
    inner,
    magic: (markers.get("magic") ?? [])[0] ?? null,
    header,
    entries,
    markers,
    soc,
    socEvidence: socValues.slice(0, 6),
    fingerprint: fpValue ?? (fingerprints[0] ?? null),
    pixelIdentity,
    stockIdentity,
    build: build ?? null,
    author: author ?? null,
    zipSigned,
    zipDevice,
    zipAb,
    zipPayload,
    zipInner,
  };
}

export async function listRoms(): Promise<RomInfo[]> {
  fs.mkdirSync(ROMS_DIR, { recursive: true });
  const out: RomInfo[] = [];
  for (const entry of fs.readdirSync(ROMS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const lower = name.toLowerCase();
    const ext = ROM_EXTENSIONS.find((item) => lower.endsWith(item));
    if (!ext) continue;
    const full = path.join(ROMS_DIR, name);
    const stat = fs.statSync(full);
    const rom: RomInfo = { name, path: full, size: stat.size, mtime: stat.mtime };
    if (ext === ".zip" || ext === ".rar") {
      rom.container = ext === ".zip" ? "zip" : "rar";
      try {
        rom.inner = (await findInnerImage(full, rom.container)) ?? undefined;
      } catch {
        /* sem leitor de RAR ou arquivo ilegível: o erro aparece ao analisar */
      }
    }
    out.push(rom);
  }
  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime() || a.name.localeCompare(b.name));
}

function kindLabel(kind: RomKind): string {
  if (kind === "ota") return "OTA .zip · Local Update";
  if (kind === "phoenix") return "imagem completa · PhoenixSuit/PhoenixCard";
  if (kind === "card") return "imagem de cartão · PhoenixCard";
  if (kind === "archive") return "imagem dentro do arquivo · PhoenixSuit/PhoenixCard";
  return "formato não reconhecido";
}

function romHint(rom: RomInfo): string {
  const hints: string[] = [kindLabel(detectKind(rom))];
  if (rom.container && rom.inner) hints.push(`${rom.container.toUpperCase()} › ${rom.inner.name}`);
  if (/H616|H618/i.test(rom.name)) hints.push("H616 no nome (não conferido)");
  else if (/H6(?!\d)/i.test(rom.name)) hints.push("H6 no nome (outro SoC)");
  if (/transpeed/i.test(rom.name)) hints.push("Transpeed");
  return hints.join(" · ");
}

export async function formatRomList(intro?: string): Promise<string> {
  const roms = await listRoms();
  const lines: string[] = [];
  if (intro) lines.push(intro, "");
  lines.push("── ROMs na pasta ───────────────────────", `  ${ROMS_DIR}`, "");
  if (roms.length === 0) {
    lines.push(
      "  (vazia)",
      "",
      "Coloque a ROM nessa pasta. Use a ROM feita para a placa desta box:",
      "Transpeed H616, SoC sun50iw9p1. ROM de H6 (sun50iw6) não serve,",
      "mesmo sendo Transpeed.",
      "",
      "Formatos:",
      "  .zip  pacote OTA assinado      → instalado pelo Local Update da box",
      "  .zip  com um .img dentro       → imagem completa, gravação física",
      "  .rar  com um .img dentro       → imagem completa, gravação física",
      "  .img  imagem completa Allwinner → PhoenixSuit (USB/FEL) ou PhoenixCard (SD)",
      "",
      "O .img dentro de .zip/.rar é lido direto do arquivo, sem extrair.",
      "Para .rar o programa usa o UnRAR do WinRAR ou o 7-Zip (veja TX_UNRAR).",
      "",
      "Depois:",
      "  update firmware <alvo>                 vê o estado da box e a lista",
      "  update firmware <alvo> <rom>           analisa a ROM (não altera nada)",
      "  update firmware <alvo> <rom> confirmar OTA instala; imagem completa só gera o kit",
    );
    return lines.join("\n");
  }
  const width = Math.max(...roms.map((r) => r.name.length));
  roms.forEach((rom, index) => {
    const hint = romHint(rom);
    lines.push(
      `  ${String(index + 1).padStart(2)}  ${rom.name.padEnd(width)}  ${fmtBytes(rom.size).padStart(9)}  ${fmtDate(rom.mtime)}${hint ? `  · ${hint}` : ""}`,
    );
  });
  lines.push(
    "",
    "Para .zip/.rar, o tamanho mostrado é o do arquivo; o .img de dentro é lido",
    "em streaming e não é extraído para o disco.",
    "A placa mostrada aqui vem do nome do arquivo; quem confere o conteúdo é o",
    "update firmware (uma ROM chamada H616 pode ter imagem de H6).",
    "",
    "Use o número ou parte do nome:",
    "  update firmware <alvo> <rom>           analisa a ROM e mostra o plano",
    "  update firmware <alvo> <rom> confirmar OTA instala; imagem completa só gera o kit",
  );
  return lines.join("\n");
}

async function resolveRom(query: string): Promise<RomInfo | { error: string }> {
  const roms = await listRoms();
  if (roms.length === 0) {
    return {
      error: `Nenhuma ROM em ${ROMS_DIR}.\nColoque a imagem .img, o pacote OTA .zip ou um .zip/.rar com o .img dentro e rode de novo.`,
    };
  }
  const clean = query.trim().replace(/^["']|["']$/g, "");
  if (/^\d+$/.test(clean)) {
    const index = Number(clean) - 1;
    if (roms[index]) return roms[index];
    return { error: `Não existe ROM número ${clean}. A lista tem ${roms.length}.` };
  }
  const lower = clean.toLowerCase();
  const exact = roms.find((r) => r.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = roms.filter((r) => r.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    return {
      error: [
        `"${query}" combina com ${partial.length} ROMs:`,
        ...partial.map((r) => `  • ${r.name}`),
        "Use o nome completo ou o número da lista.",
      ].join("\n"),
    };
  }
  return { error: `Não encontrei "${query}" em ${ROMS_DIR}. Rode update firmware list para ver as ROMs.` };
}

function parseProps(raw: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/);
    if (match) props.set(match[1], match[2]);
  }
  return props;
}

async function inspectTarget(device: DeviceTarget): Promise<TargetInfo> {
  const [rootRaw, propsRaw, partRaw, emmcRaw, dfRaw, updaterPaths] = await Promise.all([
    sh(device, "id", 6000, true).catch(() => ""),
    sh(device, "getprop", 15000).catch(() => ""),
    sh(device, "cat /proc/partitions", 8000).catch(() => ""),
    sh(device, "blockdev --getsize64 /dev/block/mmcblk0", 6000, true).catch(() => ""),
    sh(device, "df -k /data", 8000).catch(() => ""),
    sh(device, `pm path ${UPDATER_PACKAGE}`, 8000).catch(() => ""),
  ]);

  const partitions: string[] = [];
  for (const line of partRaw.split(/\r?\n/)) {
    const match = line.trim().match(/^\d+\s+\d+\s+\d+\s+(mmcblk0p\d+)$/);
    if (match) partitions.push(match[1]);
  }

  const emmcFromProc = Number(partRaw.match(/^\s*\d+\s+\d+\s+(\d+)\s+mmcblk0\s*$/m)?.[1] ?? 0);
  const emmcBytes = Number(emmcRaw.trim()) || (emmcFromProc ? emmcFromProc * 1024 : null);

  const dfLine = dfRaw.trim().split(/\r?\n/).filter(Boolean).pop()?.trim().split(/\s+/) ?? [];
  const availableKb = Number(dfLine[3]);
  const availableBytes = Number.isFinite(availableKb) && availableKb > 0 ? availableKb * 1024 : null;

  const dump = await sh(device, `dumpsys package ${UPDATER_PACKAGE}`, 15000).catch(() => "");
  const updater = Boolean(updaterPaths.trim()) && /android\.uid\.system/.test(dump);

  return {
    root: /\buid=0\b/.test(rootRaw),
    props: parseProps(propsRaw),
    partitions,
    emmcBytes,
    availableBytes,
    updater: Boolean(updaterPaths.trim()) && updater,
  };
}

function prop(info: TargetInfo, key: string): string {
  return info.props.get(key)?.trim() ?? "";
}

function identityLine(info: TargetInfo): string {
  const fp = prop(info, "ro.build.fingerprint");
  if (/google\/sailfish/i.test(fp)) return `${fp} (identidade de Pixel, não é a do hardware)`;
  return fp || "?";
}

function targetReport(device: DeviceTarget, info: TargetInfo): string[] {
  const board = prop(info, "ro.hardware") || prop(info, "ro.board.platform");
  const lines = [
    "── Destino ─────────────────────────────",
    `  Endpoint    : ${device.endpoint}`,
    `  Modelo      : ${prop(info, "ro.product.model") || "?"} (${prop(info, "ro.product.device") || "?"})`,
    `  Placa       : ${board || "?"} · Android ${prop(info, "ro.build.version.release") || "?"} (SDK ${prop(info, "ro.build.version.sdk") || "?"})`,
    `  Build       : ${prop(info, "ro.fota.version") || prop(info, "ro.build.display.id") || "?"}`,
    `  Fingerprint : ${identityLine(info)}`,
    `  eMMC        : ${info.emmcBytes ? fmtBytes(info.emmcBytes) : "?"}`,
    `  Livre /data : ${info.availableBytes ? fmtBytes(info.availableBytes) : "?"}`,
    `  Root        : ${info.root ? "sim" : "não (backup e Local Update precisam de root)"}`,
    `  Local Update: ${info.updater ? "disponível (com.softwinner.update)" : "não encontrado"}`,
  ];
  return lines;
}

function compatibility(rom: ImageReport, target: TargetInfo): Verdict {
  const lines: string[] = [];
  const name = rom.info.name;
  const nameSoc: ImageReport["soc"] = /H61[68]/i.test(name)
    ? "sun50iw9"
    : /H6(?!\d)|sun50iw6/i.test(name)
      ? "sun50iw6"
      : "unknown";
  let level: Verdict["level"] = "ok";

  if (rom.kind === "unknown") {
    level = "block";
    if (rom.info.container) {
      lines.push(
        `o ${rom.info.container.toUpperCase()} não contém um .img e não é um pacote OTA (.zip com update-binary).`,
        "Use um pacote OTA .zip assinado ou um .zip/.rar com a imagem .img dentro.",
      );
    } else {
      lines.push(
        "o formato não foi reconhecido. Não é um pacote OTA (.zip com update-binary)",
        "nem uma imagem Allwinner (IMAGEWTY/RFSFAT16). Não há como instalar com segurança.",
      );
    }
    return { level, lines };
  }

  if (rom.soc === "sun50iw6") {
    level = "block";
    if (nameSoc === "sun50iw9") {
      lines.push(
        "o nome do arquivo diz H616, mas o conteúdo é de H6 (sun50iw6).",
        "Quem manda é o conteúdo: a imagem foi compilada para outra placa.",
        "Gravar esta imagem pode deixar a box sem boot.",
      );
    } else {
      lines.push(
        "o conteúdo da imagem é de H6 (sun50iw6), não H616 (sun50iw9p1).",
        "Gravar esta imagem pode deixar a box sem boot.",
      );
    }
  } else if (rom.soc === "sun50iw9") {
    if (nameSoc === "sun50iw6") {
      level = "warn";
      lines.push(
        "o conteúdo é para sun50iw9p1 (H616/H618), mas o nome do arquivo diz H6.",
        "Confira a origem da ROM antes de gravar.",
      );
    } else {
      lines.push("placa compatível: Sunxi sun50iw9p1 (H616/H618).");
    }
  } else if (nameSoc === "sun50iw6") {
    level = "block";
    lines.push(
      "o nome do arquivo diz H6 (sun50iw6) e o conteúdo não confirmou a placa.",
      "Trate como imagem para H6: não grave na box H616.",
    );
  } else if (rom.kind !== "ota") {
    level = "warn";
    lines.push("não encontrei a placa na imagem; confirme que a ROM é do Transpeed H616.");
  }

  if (rom.pixelIdentity) {
    level = level === "block" ? level : "warn";
    lines.push(
      "a imagem contém a identidade google/sailfish (Pixel). Instalar esta ROM",
      "NÃO remove o fingerprint falso e provavelmente mantém a recusa do Google.",
    );
  } else if (rom.stockIdentity) {
    lines.push("a imagem usa a identidade Transpeed_H616 (sem google/sailfish).");
  }

  const models = rom.markers.get("model") ?? [];
  const otherModel = models.find((v) => /transpeed/i.test(v) && !/H616/i.test(v));
  if (otherModel && level !== "block") {
    level = "warn";
    lines.push(`a imagem menciona outro modelo Transpeed (${otherModel}); confira a placa.`);
  }

  if (rom.kind === "ota") {
    if (rom.zipAb) {
      level = "block";
      lines.push("o pacote é uma OTA A/B (payload.bin); esta box não tem slots A/B.");
    }
    if (rom.zipDevice) {
      const allowed = rom.zipDevice.split(/\s*\/\s*/).filter(Boolean);
      const device = prop(target, "ro.product.device");
      const product = prop(target, "ro.product.name");
      if (!allowed.some((v) => v === device || v === product)) {
        level = "block";
        lines.push(
          `o updater-script exige o aparelho "${rom.zipDevice}", mas a box é "${device || product || "?"}"`,
          "A verificação do fabricante vai abortar a instalação.",
        );
      } else {
        lines.push(`aparelho aceito pelo updater-script: ${rom.zipDevice}.`);
      }
    } else if (level !== "block") {
      level = "warn";
      lines.push("o pacote não declara a placa no updater-script; a verificação fica só por conta do fabricante.");
    }
    if (!rom.zipSigned) {
      level = "block";
      lines.push(
        "o pacote não tem assinatura de OTA (bloco de assinatura/otacert).",
        "RecoverySystem.verifyPackage recusa: o Local Update mostraria Package verify failed.",
      );
    } else {
      lines.push("assinatura de OTA presente; a chave ainda tem de constar em /system/etc/security/otacerts.zip.");
    }
    if (target.availableBytes && rom.info.size + 256 * 1024 * 1024 > target.availableBytes) {
      level = "block";
      lines.push(`não há espaço para enviar o pacote: livre ${fmtBytes(target.availableBytes)}.`);
    }
    if (!target.root) {
      level = "block";
      lines.push("o aparelho não tem root; sem isso não dá para abrir o Local Update.");
    }
    if (!target.updater) {
      level = "block";
      lines.push("o app de atualização do fabricante (com.softwinner.update) não está disponível.");
    }
  } else {
    if (target.emmcBytes && rom.contentSize > target.emmcBytes) {
      level = "block";
      lines.push(`a imagem (${fmtBytes(rom.contentSize)}) é maior que o eMMC (${fmtBytes(target.emmcBytes)}).`);
    }
    if (rom.kind === "archive" && level !== "block") {
      level = "warn";
      lines.push("o .img dentro do arquivo não tem cabeçalho Allwinner (IMAGEWTY/RFSFAT16); confirme que é uma imagem completa.");
    }
    if (level !== "block") {
      if (!target.root) {
        level = "warn";
        lines.push("sem root: o backup automático das partições não vai funcionar.");
      }
      lines.push(
        "imagem completa: o ADB não grava no eMMC; o comando não instala esta ROM.",
        "O Local Update não aceita esta imagem: ele só instala OTA .zip assinado.",
      );
      if (rom.inner) {
        lines.push(
          `a imagem fica dentro do ${rom.info.container?.toUpperCase()} e é lida dali sem extrair;`,
          "o arquivo compactado pode continuar em roms/ como fonte.",
        );
      }
    }
  }

  return { level, lines };
}

function imageReport(rom: ImageReport): string[] {
  const format =
    rom.kind === "ota"
      ? "pacote OTA (.zip)"
      : rom.kind === "phoenix"
        ? "imagem completa Allwinner (IMAGEWTY) · PhoenixSuit (USB/FEL) ou PhoenixCard (SD)"
        : rom.kind === "card"
          ? "imagem de cartão Allwinner (RFSFAT16) · PhoenixCard (SD)"
          : rom.kind === "archive"
            ? "imagem dentro do arquivo · cabeçalho Allwinner não reconhecido"
            : "formato não identificado";
  const evidence = rom.socEvidence.filter(
    (v) => !(rom.soc === "sun50iw9" && /^sun50iw9/i.test(v)) && !(rom.soc === "sun50iw6" && /^sun50iw6/i.test(v)),
  );
  const lines = [
    "── ROM ─────────────────────────────────",
    `  Arquivo     : ${rom.info.name}${rom.inner ? ` · ${rom.info.container?.toUpperCase()}` : ""}`,
    `  Tamanho     : ${fmtBytes(rom.info.size)}${rom.inner ? " (o arquivo)" : ""}`,
  ];
  if (rom.inner) {
    lines.push(
      `  Conteúdo    : ${rom.inner.name}`,
      `  Imagem      : ${fmtBytes(rom.contentSize)} · lida direto do ${rom.info.container?.toUpperCase()}, sem extrair`,
    );
  }
  lines.push(
    `  Formato     : ${format}`,
    `  ${rom.inner ? "SHA-256 img" : "SHA-256    "} : ${rom.sha256}`,
  );
  if (rom.kind === "ota") {
    lines.push(
      `  Assinatura  : ${rom.zipSigned ? "presente (bloco de assinatura/otacert)" : "AUSENTE — o fabricante vai recusar"}`,
      `  Aparelho    : ${rom.zipDevice ?? "não declarado no updater-script"}`,
      `  Tipo        : ${rom.zipAb ? "OTA A/B (payload.bin)" : "OTA por script/blocos (sem A/B)"}`,
    );
    if (rom.zipPayload.length) lines.push(`  Conteúdo    : ${rom.zipPayload.slice(0, 6).join(", ")}`);
  } else {
    lines.push(
      `  SoC         : ${rom.soc === "sun50iw9" ? "sun50iw9p1 (H616/H618)" : rom.soc === "sun50iw6" ? "sun50iw6 (H6)" : "não identificado"}${
        evidence.length ? ` · ${evidence.join(", ")}` : ""
      }`,
      `  Identidade  : ${rom.pixelIdentity ? "google/sailfish (Pixel)" : rom.stockIdentity ? "Transpeed_H616 (original)" : rom.fingerprint ?? "não encontrada"}`,
    );
    if (rom.build) lines.push(`  Build       : ${rom.build}`);
    if (rom.author) lines.push(`  Autor       : ${rom.author}`);
    const headerKeys = [...rom.header.entries()].filter(([k]) => /SIZE|VERSION|DATE|PLATFORM|MODEL/i.test(k)).slice(0, 6);
    if (headerKeys.length) lines.push(`  Cabeçalho   : ${headerKeys.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
    if (rom.entries.length) lines.push(`  Arquivos    : ${rom.entries.slice(0, 12).join(", ")}${rom.entries.length > 12 ? "…" : ""}`);
  }
  return lines;
}

function finalNotes(rom: ImageReport, target: TargetInfo): string[] {
  const lines = [
    "── Depois da instalação ────────────────",
    rom.kind === "ota"
      ? "  • O Local Update aplica o pacote OTA e reinicia; em geral os dados do usuário são mantidos."
      : "  • A gravação física substitui o sistema inteiro; os dados do usuário são apagados.",
    "  • O GSF ID muda junto com os dados. Registre o novo ID em",
    "    https://www.google.com/android/uncertified e espere a propagação.",
    "  • Rode `play <alvo>` para comparar o fingerprint novo com a identidade",
    "    que a ROM realmente traz.",
    "  • Nenhuma ROM de terceiro garante certificação: o veredito é do Google,",
    "    por GSF ID + fingerprint. Só um build licenciado muda esse cenário.",
  ];
  if (prop(target, "ro.vendor.build.version.ota")) {
    lines.push(`  • A ROM atual declara OTA ${prop(target, "ro.vendor.build.version.ota")}; confira se a nova é mais recente.`);
  }
  return lines;
}

export async function firmwarePlan(device: DeviceTarget, romQuery: string): Promise<{ ok: boolean; output: string }> {
  const rom = await resolveRom(romQuery);
  if ("error" in rom) return { ok: false, output: rom.error };

  const target = await inspectTarget(device);
  const report = await inspectImage(rom);
  const verdict = compatibility(report, target);

  const blockReason = verdict.level === "block";
  const romName = rom.name;
  const lines = [
    `${device.ip} — atualização de firmware`,
    "",
    ...imageReport(report),
    "",
    ...targetReport(device, target),
    "",
    "── Compatibilidade ─────────────────────",
    ...verdict.lines.map((line) => (line.startsWith(" ") ? line : `  ${line}`)),
    "",
  ];

  if (blockReason) {
    lines.push(
      "  BLOQUEADO: nada será backupado, enviado ou gravado.",
      "  Use uma ROM para Transpeed H616 (sun50iw9p1) no formato correto e tente de novo.",
    );
    return { ok: false, output: lines.join("\n") };
  }

  if (report.kind === "ota") {
    lines.push(
      "── Plano ───────────────────────────────",
      `  1. Backup de ${CRITICAL_PARTITIONS.join(", ")}`,
      `     → ${path.join(BACKUPS_DIR, safeName(device.ip))}`,
      `  2. Envio do pacote para ${REMOTE_DIR}/${romName}`,
      "  3. Conferência do SHA-256 no aparelho",
      "  4. Abertura do Local Update e verificação do fabricante na TV",
      "  5. Início automático da instalação quando a verificação passar",
      "",
      "  Nada foi alterado ainda. Para executar:",
      `    update firmware ${device.ip} "${romName}" confirmar`,
      "",
      ...finalNotes(report, target),
    );
    return { ok: true, output: lines.join("\n") };
  }

  lines.push(
    "── Rota ────────────────────────────────",
    `  Imagem completa (${kindLabel(report.kind)}): este comando NÃO instala .img no eMMC.`,
    "  O Local Update da box usa RecoverySystem.verifyPackage e só aceita OTA .zip",
    "  assinado; o ADB não tem como gravar uma imagem completa no armazenamento.",
    "",
    "  O confirmar não vai fingir sucesso: ele faz o backup das partições, grava o",
    "  kit de gravação física em backups/ e termina com NADA FOI INSTALADO.",
    ...(report.inner
      ? [
          "",
          `  Imagem: ${report.inner.name} (${fmtBytes(report.contentSize)}) dentro de ${rom.name}.`,
        ]
      : []),
    "",
    "  Para instalar por este comando, use um pacote OTA .zip assinado para a box.",
  );
  return { ok: false, output: lines.join("\n") };
}

async function backupDevice(device: DeviceTarget, target: TargetInfo, imageSha: string): Promise<{ ok: boolean; dir: string; lines: string[] }> {
  const dir = path.join(BACKUPS_DIR, safeName(device.ip), new Date().toISOString().replace(/[:.]/g, "-"));
  const lines = ["── Backup ──────────────────────────────", `  Pasta: ${dir}`];
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, dir, lines: [...lines, `  Falha ao criar a pasta: ${(e as Error).message}`] };
  }

  const existingRaw = await sh(device, "ls /dev/block/by-name", 8000).catch(() => "");
  const existing = new Set(existingRaw.split(/\s+/).filter(Boolean));
  const sizesRaw = await sh(
    device,
    "for p in bootloader env boot recovery misc vbmeta vbmeta_system vbmeta_vendor; do [ -e /dev/block/by-name/$p ] && echo \"$p $(blockdev --getsize64 /dev/block/by-name/$p)\"; done",
    15000,
    true,
  ).catch(() => "");
  const sizes = new Map<string, number>();
  for (const line of sizesRaw.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(\d+)$/);
    if (match) sizes.set(match[1], Number(match[2]));
  }

  const sums: string[] = [];
  for (const name of CRITICAL_PARTITIONS) {
    if (!existing.has(name)) continue;
    const expected = sizes.get(name) ?? 0;
    try {
      const data = await runBuffer(
        "adb",
        ["-s", device.endpoint, "exec-out", "su", "0", "dd", `if=/dev/block/by-name/${name}`, "bs=1M", "status=none"],
        240000,
      );
      if (data.length === 0) throw new Error("dd não devolveu dados");
      const image = expected && data.length > expected ? data.subarray(0, expected) : data;
      if (expected && image.length !== expected) throw new Error(`tamanho ${image.length} B, esperado ${expected} B`);
      fs.writeFileSync(path.join(dir, `${name}.img`), data);
      const digest = crypto.createHash("sha256").update(data).digest("hex");
      sums.push(`${digest}  ${name}.img`);
      lines.push(`  • ${name.padEnd(14)} ${fmtBytes(data.length).padStart(9)}  ok`);
    } catch (e) {
      return {
        ok: false,
        dir,
        lines: [...lines, `  • ${name}: FALHOU — ${(e as Error).message}`, "  Backup incompleto: nada foi enviado para a box."],
      };
    }
  }

  const [props, partitions, byName] = await Promise.all([
    sh(device, "getprop", 15000).catch(() => ""),
    sh(device, "cat /proc/partitions", 8000).catch(() => ""),
    sh(device, "ls -l /dev/block/by-name", 8000).catch(() => ""),
  ]);
  fs.writeFileSync(path.join(dir, "props.txt"), props);
  fs.writeFileSync(path.join(dir, "partitions.txt"), partitions);
  fs.writeFileSync(path.join(dir, "by-name.txt"), byName);
  fs.writeFileSync(
    path.join(dir, "meta.txt"),
    [
      `alvo=${device.endpoint}`,
      `data=${new Date().toISOString()}`,
      `sha256_imagem=${imageSha}`,
    ].join("\n"),
  );
  if (sums.length) fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);
  lines.push(`  ${sums.length} partições salvas + props, tabela e hashes.`);
  return { ok: sums.length > 0, dir, lines };
}

async function stageImage(
  device: DeviceTarget,
  rom: RomInfo,
  localSha: string,
  target: TargetInfo,
  lines: string[],
): Promise<{ ok: boolean; remote: string }> {
  const remote = `${REMOTE_DIR}/${rom.name}`;
  lines.push("", "── Envio ───────────────────────────────");
  if (target.availableBytes && rom.size + 256 * 1024 * 1024 > target.availableBytes) {
    lines.push(`  Sem espaço: livre ${fmtBytes(target.availableBytes)}, imagem ${fmtBytes(rom.size)}.`);
    return { ok: false, remote };
  }
  await sh(device, `mkdir -p ${REMOTE_DIR}`, 8000).catch(() => "");
  const timeout = Math.min(1800000, Math.max(180000, Math.round(rom.size / 1048576 / 3) * 1000));
  const pushed = await run("adb", ["-s", device.endpoint, "push", "-p", rom.path, remote], timeout).catch((e: Error) => e.message);
  if (/error|failed|no space/i.test(pushed) && !/1 file pushed|file pushed/i.test(pushed)) {
    lines.push(`  Falha no envio: ${pushed.trim() || "sem resposta"}`);
    return { ok: false, remote };
  }
  lines.push(`  • imagem enviada (${fmtBytes(rom.size)})`);

  const remoteShaRaw = await sh(device, `sha256sum ${sq(remote)}`, 300000).catch((e: Error) => e.message);
  const remoteSha = remoteShaRaw.match(/\b([0-9a-f]{64})\b/i)?.[1]?.toLowerCase() ?? null;
  if (!remoteSha) {
    lines.push(`  • não consegui conferir o sha256 na box: ${remoteShaRaw.trim().split(/\r?\n/)[0] || "sem resposta"}`);
    return { ok: false, remote };
  }
  if (remoteSha !== localSha.toLowerCase()) {
    lines.push("  • SHA-256 DIVERGENTE: o arquivo chegou corrompido.", `    local: ${localSha}`, `    box  : ${remoteSha}`);
    return { ok: false, remote };
  }
  lines.push(`  • sha256 conferido: ${remoteSha}`);
  return { ok: true, remote };
}

async function localTools(): Promise<{ phoenixSuit: string | null; phoenixCard: string | null; sunxiFel: boolean }> {
  const existing = (file: string): string | null => {
    try {
      return fs.existsSync(file) ? file : null;
    } catch {
      return null;
    }
  };
  let phoenixSuit: string | null = null;
  let phoenixCard: string | null = null;
  for (const file of PHOENIX_TOOLS) {
    if (/PhoenixCard/i.test(file)) phoenixCard ??= existing(file);
    else phoenixSuit ??= existing(file);
  }
  const where = async (exe: string): Promise<string | null> => {
    const out = await run("where", [exe], 5000).catch(() => "");
    return out.split(/\r?\n/).map((line) => line.trim()).find((line) => /\.exe$/i.test(line)) ?? null;
  };
  phoenixSuit ??= await where("PhoenixSuit.exe");
  phoenixCard ??= await where("PhoenixCard.exe");
  const fel = await where("sunxi-fel.exe");
  return { phoenixSuit, phoenixCard, sunxiFel: Boolean(fel) };
}

function flashKitText(device: DeviceTarget, rom: ImageReport, tools: Awaited<ReturnType<typeof localTools>>): string {
  const lines = [
    "Kit de gravação — firmware completo Allwinner",
    `Alvo     : ${device.ip}`,
    `Gerado   : ${new Date().toISOString()}`,
    `Arquivo  : ${rom.info.path}${rom.inner ? ` › ${rom.inner.name}` : ""}`,
    `Tamanho  : ${fmtBytes(rom.info.size)} (arquivo)${rom.inner ? ` · imagem ${fmtBytes(rom.contentSize)}` : ""}`,
    `SHA-256  : ${rom.sha256}${rom.inner ? " (da imagem dentro do arquivo)" : ""}`,
    `Formato  : ${rom.kind === "card" ? "imagem de cartão (RFSFAT16)" : rom.kind === "phoenix" ? "imagem completa (IMAGEWTY)" : "imagem não confirmada"}`,
  ];
  if (rom.inner) {
    lines.push(
      "",
      "Imagem compactada:",
      `  O .img está dentro de ${rom.info.name} e o diagnóstico foi feito sem extrair.`,
      "  PhoenixCard e PhoenixSuit só aceitam um arquivo .img solto, então na hora",
      "  de gravar extraia a imagem com WinRAR ou 7-Zip (botão direito → Extrair aqui).",
      "  Se o antivírus apagar o .img extraído, libere a pasta de extração no",
      "  antivírus ou extraia em outro PC. O .rar/.zip original pode ficar guardado:",
      "  o programa sempre lê a imagem de dentro dele, sem precisar do .img solto.",
    );
  }
  lines.push(
    "",
    "Por que não pelo Local Update:",
    "  O app com.softwinner.update verifica o pacote com RecoverySystem.verifyPackage,",
    "  que só aceita OTA .zip assinado. Uma imagem .img completa é recusada",
    "  (Package verify failed), mesmo sendo a ROM correta para a placa.",
    "",
    "ROTA A — PhoenixCard (cartão SD, recomendada)",
    `  Ferramenta: ${tools.phoenixCard ?? "não encontrada no PC — instale o PhoenixCard do pacote Allwinner"}`,
    "  1. Use um cartão SD com capacidade igual ou maior que a imagem.",
    "  2. Abra o PhoenixCard, selecione a imagem e o cartão.",
    "  3. Escolha o modo Product (use Startup apenas se o tutorial da ROM pedir).",
    "  4. Clique em Burn e espere terminar.",
    "  5. Desligue a box, insira o cartão e ligue. A gravação começa sozinha.",
    "  6. Ao terminar, desligue, remova o cartão e ligue novamente.",
    "",
    "ROTA B — PhoenixSuit / LiveSuit (USB, modo FEL)",
    `  Ferramenta: ${tools.phoenixSuit ?? "não encontrada no PC — instale o PhoenixSuit do pacote Allwinner"}`,
    "  1. Desligue a box e desconecte a alimentação.",
    "  2. Com um palito, pressione o botão de flash dentro da entrada AV",
    "     (ou use o ponto FEL da placa) e mantenha pressionado.",
    "  3. Conecte o cabo USB OTG ao PC e abra o PhoenixSuit.",
    "  4. Selecione a imagem e clique em Upgrade.",
    "  5. Espere o fim e desconecte; a box reinicia no sistema novo.",
  );
  if (tools.sunxiFel) {
    lines.push(
      "",
      "Alternativa por linha de comando:",
      "  sunxi-fel foi encontrado no PATH. Com a box em FEL, o pacote",
      "  sunxi-tools pode gravar a imagem. Prefira PhoenixSuit se não tiver certeza.",
    );
  }
  lines.push(
    "",
    "Depois da gravação:",
    "  • O sistema inteiro é substituído e os dados do usuário são apagados.",
    "  • O GSF ID muda; registre o novo em https://www.google.com/android/uncertified.",
    "  • Rode `play <alvo>` para conferir a identidade que a ROM trouxe.",
    "  • Nenhuma ROM de terceiro garante certificação do Play.",
  );
  return lines.join("\n");
}

async function launchUpdater(device: DeviceTarget, remote: string): Promise<{ ok: boolean; line: string }> {
  const command = `am start -n ${UPDATER_ACTIVITY} --es path ${sq(remote)}`;
  const out = await sh(device, command, 20000, true).catch((e: Error) => e.message);
  if (/Starting:|Warning: Activity not started/i.test(out)) {
    return { ok: true, line: "  • Local Update aberto na TV" };
  }
  return { ok: false, line: `  • não consegui abrir o Local Update: ${out.trim().split(/\r?\n/)[0] || "sem resposta"}` };
}

async function readUpdaterUi(device: DeviceTarget): Promise<string> {
  return sh(device, "uiautomator dump /sdcard/.fw_ui.xml >/dev/null 2>&1; cat /sdcard/.fw_ui.xml", 20000).catch(() => "");
}

async function waitVerification(device: DeviceTarget, timeoutMs = 45000): Promise<"ready" | "failed" | "pending" | "closed"> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    await delay(4000);
    const xml = await readUpdaterUi(device);
    if (!xml) continue;
    last = xml;
    if (/Package verify failed/i.test(xml)) return "failed";
    if (/<node[^>]*text="Start install"[^>]*enabled="true"/.test(xml)) return "ready";
  }
  return /package="com\.softwinner\.update"/.test(last) ? "pending" : "closed";
}

type UiButton = { text: string; x: number; y: number };

function uiButtons(xml: string): UiButton[] {
  const buttons: UiButton[] = [];
  for (const tag of xml.match(/<node\b[^>]*>/g) ?? []) {
    if (/\benabled="false"/.test(tag)) continue;
    const text = tag.match(/\btext="([^"]+)"/)?.[1]?.trim() ?? "";
    const bounds = tag.match(/\bbounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
    if (!text || !bounds) continue;
    const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
    const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
    if (x <= 0 || y <= 0) continue;
    buttons.push({ text: text.replace(/&amp;/g, "&").replace(/&#10;/g, " "), x, y });
  }
  return buttons;
}

const INSTALL_BUTTONS = ["start install", "install", "confirm", "reboot"];

async function adbOnline(device: DeviceTarget): Promise<boolean> {
  const out = await run("adb", ["-s", device.endpoint, "get-state"], 8000).catch(() => "");
  return out.trim() === "device";
}

async function adbGone(device: DeviceTarget): Promise<boolean> {
  if (await adbOnline(device)) return false;
  await delay(3000);
  return !(await adbOnline(device));
}

async function startInstallation(device: DeviceTarget, lines: string[]): Promise<"started" | "failed" | "stuck"> {
  for (let step = 0; step < 14; step++) {
    const xml = await readUpdaterUi(device);
    if (/Package verify failed|Verifying failed/i.test(xml)) return "failed";
    const buttons = uiButtons(xml);
    const target = INSTALL_BUTTONS.map((label) => buttons.find((b) => b.text.toLowerCase() === label)).find(Boolean);
    if (target) {
      lines.push(`  • tocando em "${target.text}" (${target.x},${target.y})`);
      await sh(device, `input tap ${target.x} ${target.y}`, 8000).catch(() => "");
    }
    await delay(4000);
    if (await adbGone(device)) return "started";
    const after = await readUpdaterUi(device);
    if (/Upgrade success|reboot to install|Upgrade complated/i.test(after)) {
      await delay(4000);
      if (await adbGone(device)) return "started";
    }
  }
  return "stuck";
}

export async function firmwareInstall(
  device: DeviceTarget,
  romQuery: string,
  confirmed: boolean,
): Promise<{ ok: boolean; output: string }> {
  if (!confirmed) return firmwarePlan(device, romQuery);

  const rom = await resolveRom(romQuery);
  if ("error" in rom) return { ok: false, output: rom.error };

  const target = await inspectTarget(device);
  const report = await inspectImage(rom);
  const verdict = compatibility(report, target);
  if (verdict.level === "block") {
    return {
      ok: false,
      output: [
        `${device.ip} — atualização de firmware`,
        "",
        ...imageReport(report),
        "",
        ...targetReport(device, target),
        "",
        "── Compatibilidade ─────────────────────",
        ...verdict.lines.map((line) => (line.startsWith(" ") ? line : `  ${line}`)),
        "",
        "  BLOQUEADO: nada foi backupado nem enviado.",
      ].join("\n"),
    };
  }

  const lines: string[] = [
    `${device.ip} — atualização de firmware`,
    "",
    `  ROM: ${rom.name}${report.inner ? ` › ${report.inner.name}` : ""} (${fmtBytes(report.inner ? report.contentSize : rom.size)})`,
    `  SHA-256: ${report.sha256}`,
    "",
  ];

  const backup = await backupDevice(device, target, report.sha256);
  lines.push(...backup.lines);
  if (!backup.ok && report.kind === "ota") {
    lines.push("", "  Abortado antes de enviar o pacote.");
    return { ok: false, output: lines.join("\n") };
  }

  if (report.kind !== "ota") {
    const tools = await localTools();
    const kitPath = path.join(backup.dir, "flash-kit.txt");
    let kitOk = true;
    try {
      fs.writeFileSync(kitPath, flashKitText(device, report, tools));
    } catch (e) {
      kitOk = false;
    }
    lines.push(
      "",
      "── Resultado ───────────────────────────",
      "  NADA FOI INSTALADO.",
      "",
      `  ${rom.name} não é um pacote OTA (${kindLabel(report.kind)}).`,
      "  O Local Update da box só aceita OTA .zip assinado e o ADB não grava",
      "  imagem completa no eMMC, então este comando não instala esta ROM.",
      "",
      "  Feito até aqui:",
      backup.ok
        ? `    • backup das partições em ${backup.dir}`
        : "    • backup INCOMPLETO (veja acima); o kit foi gerado mesmo assim",
      kitOk
        ? `    • kit de gravação física em ${kitPath}`
        : "    • o kit de gravação não pôde ser gravado (erro de escrita no PC)",
      "",
      "  A imagem não foi enviada para a box e o eMMC não foi alterado.",
    );
    if (report.inner) {
      lines.push(
        "",
        `  A imagem (${report.inner.name}) continua dentro de ${rom.name}; o programa`,
        "  a leu e conferiu dali sem extrair. O kit aponta o arquivo certo.",
      );
    }
    return { ok: false, output: lines.join("\n") };
  }

  const staged = await stageImage(device, rom, report.sha256, target, lines);
  if (!staged.ok) {
    lines.push("", "  A imagem não foi confirmada; o Local Update não foi aberto.");
    return { ok: false, output: lines.join("\n") };
  }

  lines.push("", "── Instalador ──────────────────────────");
  const launched = await launchUpdater(device, staged.remote);
  lines.push(launched.line);
  if (!launched.ok) {
    lines.push("", "  A imagem está na box; abra o app Update na TV e escolha a ROM em " + REMOTE_DIR + ".");
    return { ok: false, output: lines.join("\n") };
  }

  lines.push("  • conferindo a verificação do fabricante na tela…");
  const state = await waitVerification(device);
  lines.push("");
  if (state === "ready") {
    lines.push("  • verificação passou; iniciando a instalação…");
    const started = await startInstallation(device, lines);
    lines.push("");
    if (started === "failed") {
      lines.push("O Local Update recusou o pacote: Package verify failed. Nada foi instalado.");
      return { ok: false, output: lines.join("\n") };
    }
    if (started === "started") {
      lines.push(
        "INSTALAÇÃO INICIADA: a box está reiniciando no recovery e aplica o pacote sozinha.",
        "O ADB por rede costuma não voltar depois do reboot; a instalação não depende dele.",
        "",
        ...finalNotes(report, target),
      );
      return { ok: true, output: lines.join("\n") };
    }
    lines.push(
      "A instalação NÃO começou: o Local Update continua aberto, mas nenhum botão de",
      "instalação respondeu. Nada foi instalado. O pacote ficou em " + REMOTE_DIR + ".",
    );
    return { ok: false, output: lines.join("\n") };
  }
  if (state === "failed") {
    lines.push(
      "O Local Update recusou o pacote: Package verify failed.",
      "Nada foi gravado. O arquivo ficou em " + REMOTE_DIR + " para conferência.",
      "",
      "O verificador usa RecoverySystem.verifyPackage e exige que a assinatura",
      "do pacote conste em /system/etc/security/otacerts.zip. Um pacote de outro",
      "modelo, versão ou chave de assinatura é recusado mesmo sendo OTA válido.",
    );
    return { ok: false, output: lines.join("\n") };
  }
  if (state === "pending") {
    lines.push(
      "A janela ainda está verificando a imagem; nada foi instalado ainda.",
      "A verificação demorou mais que o normal. O pacote ficou em " + REMOTE_DIR + ".",
    );
    return { ok: false, output: lines.join("\n") };
  }
  if (await adbGone(device)) {
    lines.push(
      "INSTALAÇÃO INICIADA: a box saiu do ADB e está reiniciando para aplicar o pacote.",
      "O ADB por rede costuma não voltar depois do reboot; a instalação não depende dele.",
      "",
      ...finalNotes(report, target),
    );
    return { ok: true, output: lines.join("\n") };
  }
  lines.push(
    "A janela do Local Update não está mais em primeiro plano e a instalação não começou.",
    "A ROM está em " + REMOTE_DIR + "; abra o app Update na TV e escolha o pacote.",
  );
  return { ok: false, output: lines.join("\n") };
}

export async function firmwareStatus(device: DeviceTarget): Promise<string> {
  const target = await inspectTarget(device);
  return [targetReport(device, target).join("\n"), "", await formatRomList()].join("\n");
}
