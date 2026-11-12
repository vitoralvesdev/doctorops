import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export type ZipEntry = { name: string; size: number; compressed: number; method: number; offset: number };

export type InnerFile = {
  container: "zip" | "rar";
  name: string;
  size: number | null;
  entry?: ZipEntry;
};

export function readSlice(file: string, position: number, length: number): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    if (position < 0) position = 0;
    const out = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const got = fs.readSync(fd, out, read, length - read, position + read);
      if (got === 0) break;
      read += got;
    }
    return out.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export function zipDirectory(file: string): { entries: ZipEntry[]; signed: boolean } | null {
  const size = fs.statSync(file).size;
  const tailLength = Math.min(size, 66 * 1024);
  const tail = readSlice(file, size - tailLength, tailLength);
  const eocd = tail.lastIndexOf(Buffer.from("PK\x05\x06", "latin1"));
  if (eocd < 0) return null;
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (!cdSize || !count || cdOffset + cdSize > size) return null;

  const cd = readSlice(file, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  while (cursor + 46 <= cd.length && cd.readUInt32LE(cursor) === 0x02014b50 && entries.length < 20000) {
    const method = cd.readUInt16LE(cursor + 10);
    const compressed = cd.readUInt32LE(cursor + 20);
    const uncompressed = cd.readUInt32LE(cursor + 24);
    const nameLength = cd.readUInt16LE(cursor + 28);
    const extraLength = cd.readUInt16LE(cursor + 30);
    const commentLength = cd.readUInt16LE(cursor + 32);
    const offset = cd.readUInt32LE(cursor + 42);
    const name = cd.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, size: uncompressed, compressed, method, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length !== count) return null;

  const blockTail = readSlice(file, Math.max(0, cdOffset - 4096), Math.min(cdOffset, 4096));
  const hasBlock = blockTail.includes(Buffer.from("APK Sig Block 42", "latin1"));
  const hasOtaCert = entries.some((e) => /^META-INF\/com\/android\/otacert$/i.test(e.name));
  const hasJarSignature = entries.some((e) => /^META-INF\/[^/]+\.(RSA|EC|DSA)$/i.test(e.name));
  return { entries, signed: hasBlock || hasOtaCert || hasJarSignature };
}

function exists(file: string | undefined | null): boolean {
  if (!file) return false;
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function fromPath(name: string): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, name);
    if (exists(full)) return full;
  }
  return null;
}

export function findUnrar(): string | null {
  const configured = process.env.TX_UNRAR;
  if (exists(configured)) return configured as string;
  for (const file of [
    "C:\\Program Files\\WinRAR\\UnRAR.exe",
    "C:\\Program Files (x86)\\WinRAR\\UnRAR.exe",
  ]) {
    if (exists(file)) return file;
  }
  return fromPath("UnRAR.exe");
}

export function find7z(): string | null {
  const configured = process.env.TX_7Z;
  if (exists(configured)) return configured as string;
  for (const file of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
  ]) {
    if (exists(file)) return file;
  }
  return fromPath("7z.exe");
}

function runTool(bin: string, args: string[], timeoutMs = 30000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (out.length < 4 * 1024 * 1024) out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.length < 16 * 1024) err += chunk.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out, err: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

export async function rarEntries(file: string): Promise<Array<{ name: string; size: number | null }>> {
  const unrar = findUnrar();
  if (unrar) {
    const res = await runTool(unrar, ["lb", "--", file]);
    if (res.code !== 0) {
      throw new Error(`UnRAR não conseguiu listar o arquivo (código ${res.code ?? "?"})${res.err.trim() ? `: ${res.err.trim().split(/\r?\n/)[0]}` : ""}`);
    }
    return res.out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, size: null }));
  }

  const seven = find7z();
  if (seven) {
    const res = await runTool(seven, ["l", "-slt", file], 60000);
    if (res.code !== 0) throw new Error(`7-Zip não conseguiu listar o arquivo (código ${res.code ?? "?"})`);
    const entries: Array<{ name: string; size: number | null }> = [];
    let current: { name: string; size: number | null } | null = null;
    let isFolder = false;
    for (const line of res.out.split(/\r?\n/)) {
      if (line.startsWith("Path = ")) {
        if (current && !isFolder) entries.push(current);
        current = { name: line.slice(7).trim(), size: null };
        isFolder = false;
      } else if (line.startsWith("Size = ") && current) {
        const value = Number(line.slice(7).trim());
        if (Number.isFinite(value)) current.size = value;
      } else if (line.startsWith("Folder = ") && current) {
        isFolder = /\+/.test(line);
      }
    }
    if (current && !isFolder) entries.push(current);
    return entries;
  }

  throw new Error(
    "para ler .rar instale o WinRAR (UnRAR.exe) ou o 7-Zip, ou defina TX_UNRAR com o caminho do UnRAR.exe",
  );
}

export async function findInnerImage(file: string, container: "zip" | "rar"): Promise<InnerFile | null> {
  if (container === "zip") {
    const zip = zipDirectory(file);
    if (!zip) return null;
    const images = zip.entries.filter((e) => /\.img$/i.test(e.name) && !/^__MACOSX\//i.test(e.name));
    if (!images.length) return null;
    images.sort((a, b) => b.size - a.size);
    const entry = images[0];
    return { container, name: entry.name, size: entry.size, entry };
  }
  const entries = await rarEntries(file);
  const images = entries.filter((e) => /\.img$/i.test(e.name));
  if (!images.length) return null;
  images.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return { container, name: images[0].name, size: images[0].size };
}

async function streamZip(
  file: string,
  entry: ZipEntry,
  onChunk: (chunk: Buffer) => boolean | void,
): Promise<void> {
  const local = readSlice(file, entry.offset, 30);
  if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("cabeçalho ZIP da imagem está corrompido");
  }
  const nameLength = local.readUInt16LE(26);
  const extraLength = local.readUInt16LE(28);
  const start = entry.offset + 30 + nameLength + extraLength;
  if (!entry.compressed) throw new Error("a imagem dentro do ZIP está vazia");
  const end = Math.min(fs.statSync(file).size - 1, start + entry.compressed - 1);

  const source = fs.createReadStream(file, { start, end, highWaterMark: 1 << 20 });
  const consume = async (iter: AsyncIterable<Buffer>) => {
    for await (const chunk of iter) {
      if (onChunk(chunk)) return true;
    }
    return false;
  };

  try {
    if (entry.method === 0) {
      await consume(source);
    } else if (entry.method === 8) {
      const inflate = zlib.createInflateRaw();
      source.pipe(inflate);
      source.on("error", (e) => inflate.destroy(e));
      await consume(inflate);
      inflate.destroy();
    } else {
      throw new Error(`compressão ZIP método ${entry.method} não suportada`);
    }
  } finally {
    source.destroy();
  }
}

async function streamRar(
  file: string,
  name: string,
  onChunk: (chunk: Buffer) => boolean | void,
): Promise<void> {
  const unrar = findUnrar();
  const seven = unrar ? null : find7z();
  if (!unrar && !seven) {
    throw new Error(
      "para ler .rar instale o WinRAR (UnRAR.exe) ou o 7-Zip, ou defina TX_UNRAR com o caminho do UnRAR.exe",
    );
  }
  const bin = (unrar ?? seven) as string;
  const args = unrar
    ? ["p", "-inul", "-p-", "--", file, name]
    : ["x", "-so", "-y", "-bd", file, name];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stopped = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 16 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (e) => finish(new Error(`não consegui executar ${path.basename(bin)}: ${e.message}`)));
    child.on("close", (code) => {
      if (stopped || code === 0) finish();
      else finish(new Error(`${path.basename(bin)} falhou ao ler "${name}" (código ${code ?? "?"})`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stopped) return;
      if (onChunk(chunk)) {
        stopped = true;
        child.kill();
        finish();
      }
    });
  });
}

export async function streamInner(
  inner: InnerFile,
  archivePath: string,
  onChunk: (chunk: Buffer) => boolean | void,
): Promise<void> {
  if (inner.container === "zip") {
    if (!inner.entry) throw new Error("entrada ZIP da imagem não localizada");
    await streamZip(archivePath, inner.entry, onChunk);
    return;
  }
  await streamRar(archivePath, inner.name, onChunk);
}
