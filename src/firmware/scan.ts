import { run } from "../adb/client.js";
import type { DeviceTarget } from "../adb/ops.js";
import { execFile } from "node:child_process";
import {
  identityFindings,
  parseProps,
  readCert,
  readCheckin,
  splitFingerprint,
  statusLabel,
} from "../adb/play.js";
import { delay } from "../core/time.js";

const PARTITION_FPS: Array<[string, string]> = [
  ["system", "ro.system.build.fingerprint"],
  ["vendor", "ro.vendor.build.fingerprint"],
  ["product", "ro.product.build.fingerprint"],
  ["odm", "ro.odm.build.fingerprint"],
  ["boot", "ro.bootimage.build.fingerprint"],
];

const VENDOR_HOSTS = [/szhxws/i, /transpeed/i, /allwinner/i, /softwinner/i];

const THIRD_PARTY_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)xdaforums?\.com$/i, "fórum XDA"],
  [/(^|\.)4pda\.(to|ru)$/i, "fórum 4PDA"],
  [/(^|\.)androidpctv\.com$/i, "blog AndroidPC.tv"],
  [/(^|\.)chinagadgetsreviews\.com$/i, "blog China Gadgets Reviews"],
  [/(^|\.)androidtvbox\.eu$/i, "blog Android TV Box"],
  [/(^|\.)repairalltv\.com$/i, "blog RepairAllTV"],
  [/(^|\.)phoenixsuit\.net$/i, "site de tutoriais PhoenixSuit"],
  [/(^|\.)freaktab\.com$/i, "fórum FreakTab"],
  [/(^|\.)aliexpress\.com$/i, "loja AliExpress"],
  [/(^|\.)drive\.google\.com$/i, "Google Drive"],
  [/(^|\.)sites\.google\.com$/i, "Google Sites"],
  [/(^|\.)mega\.nz$/i, "MEGA"],
  [/(^|\.)mediafire\.com$/i, "MediaFire"],
  [/(^|\.)yandex\.[a-z.]+$/i, "Yandex Disk"],
  [/(^|\.)dropbox\.com$/i, "Dropbox"],
  [/(^|\.)archive\.org$/i, "Internet Archive"],
  [/(^|\.)blogspot\.com$/i, "blog"],
  [/(^|\.)wordpress\.com$/i, "blog"],
  [/(^|\.)github\.com$/i, "repositório GitHub"],
];

const FILE_HOST = /(mega\.nz|drive\.google\.com|mediafire\.com|yandex\.|dropbox\.com|archive\.org)/i;

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
};

const SEARCH_TIMEOUT = 15000;
const PAGE_TIMEOUT = 12000;
const MAX_PAGE_BYTES = 700 * 1024;
const MAX_PAGES = 7;

type SearchHit = { title: string; url: string; snippet: string; engine: string };

type Page = {
  ok: boolean;
  error: string | null;
  finalUrl: string;
  host: string;
  title: string;
  published: string | null;
  text: string;
  links: string[];
};

type DateHit = { ms: number; label: string };

type Candidate = {
  hit: SearchHit;
  page: Page | null;
  host: string;
  soc: "sun50iw9" | "sun50iw6" | "unknown";
  socEvidence: string[];
  android: string | null;
  modelMatch: boolean;
  otherModel: boolean;
  filenames: string[];
  linkFiles: string[];
  downloads: string[];
  dates: DateHit[];
  official: "official" | "third-party" | "unknown";
  officialWhy: string;
  warnings: string[];
  compatible: "yes" | "no" | "check";
  compatibilityWhy: string;
  score: number;
};

type Snapshot = {
  props: Map<string, string>;
  root: boolean;
  model: string;
  manufacturer: string;
  brand: string;
  device: string;
  board: string;
  hardware: string;
  platform: string;
  oem: string;
  otaUrl: string;
  android: string;
  sdk: string;
  buildType: string;
  tags: string;
  fingerprint: string;
  fpParts: ReturnType<typeof splitFingerprint>;
  partitions: Array<[string, string]>;
  identity: string[];
  buildDate: string;
  buildUtc: number | null;
  incremental: string;
  fota: string;
  description: string;
  patch: string;
  author: string;
  emmcBytes: number | null;
  availableBytes: number | null;
  memTotalKb: number;
  memAvailKb: number;
  uptimeSec: number;
  updater: boolean;
  certRaw: string | null;
  certIssued: number | null;
  certExpires: number | null;
  gsfId: string | null;
  checkinTime: number | null;
};

function sq(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

async function sh(device: DeviceTarget, cmd: string, timeout = 10000, root = false): Promise<string> {
  const full = root ? `su 0 sh -c ${sq(cmd)}` : cmd;
  return run("adb", ["-s", device.endpoint, "shell", full], timeout);
}

function prop(props: Map<string, string>, key: string): string {
  return props.get(key)?.trim() ?? "";
}

function fmtBytes(n: number | null): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "?";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function fmtDate(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

function fmtDay(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => named[n.toLowerCase()] ?? m);
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function vendorDomain(url: string): string | null {
  const host = safeHost(url);
  if (!host) return null;
  const parts = host.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : host;
}

function isPublicUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split(".").map(Number);
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
    }
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return false;
    return true;
  } catch {
    return false;
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(Buffer.from(value.subarray(0, value.length - (total - maxBytes))));
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchText(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  referer?: string,
  extra?: Record<string, string>,
): Promise<{ status: number; finalUrl: string; text: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { ...BROWSER_HEADERS, ...(referer ? { referer } : {}), ...extra },
  });
  return { status: res.status, finalUrl: res.url || url, text: await readCapped(res, maxBytes) };
}

function unwrapDdg(href: string): string | null {
  const decoded = decodeEntities(href).trim();
  if (!decoded) return null;
  const full = decoded.startsWith("//")
    ? `https:${decoded}`
    : decoded.startsWith("/")
      ? `https://duckduckgo.com${decoded}`
      : decoded;
  try {
    const u = new URL(full);
    if (/duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith("/l/")) {
      const target = u.searchParams.get("uddg");
      return target || null;
    }
    if (/duckduckgo\.com$/i.test(u.hostname) && /\/y\.js$/.test(u.pathname)) return null;
    return full;
  } catch {
    return null;
  }
}

async function duckSearch(query: string): Promise<{ hits: SearchHit[]; note: string | null }> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`;
  let first: { status: number; finalUrl: string; text: string };
  try {
    first = await fetchText(url, SEARCH_TIMEOUT, 500 * 1024, "https://duckduckgo.com/");
  } catch (e) {
    return { hits: [], note: `DuckDuckGo não respondeu (${(e as Error).message})` };
  }

  const blocked = first.status === 202 || /anomaly|challenge|bots use duckduckgo/i.test(first.text.slice(0, 4000));
  if (blocked) {
    return { hits: [], note: "DuckDuckGo limitou as consultas diretas (HTTP 202)" };
  }

  if (first.status !== 200) return { hits: [], note: `DuckDuckGo respondeu HTTP ${first.status}` };

  const titles: Array<{ href: string; title: string }> = [];
  for (const m of first.text.matchAll(/<a([^>]*class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].match(/href="([^"]*)"/i)?.[1];
    const title = stripHtml(m[2]);
    if (!href || !title) continue;
    const target = unwrapDdg(href);
    if (!target) continue;
    titles.push({ href: target, title });
  }
  const snippets = [...first.text.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (m) => stripHtml(m[1]),
  );

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  titles.forEach((item, i) => {
    let key = item.href;
    try {
      const u = new URL(item.href);
      u.hash = "";
      key = u.toString();
    } catch {
      /* mantém a URL crua */
    }
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      title: item.title,
      url: item.href,
      snippet: snippets[i] ?? "",
      engine: "DuckDuckGo",
    });
  });

  if (!hits.length) return { hits, note: "DuckDuckGo não devolveu resultados para esta consulta" };
  return { hits, note: null };
}

function unwrapBing(href: string): string | null {
  const decoded = decodeEntities(href).trim();
  if (!decoded) return null;
  const full = decoded.startsWith("//") ? `https:${decoded}` : decoded;
  try {
    const u = new URL(full, "https://www.bing.com");
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.pathname.startsWith("/ck/a")) {
      const raw = u.searchParams.get("u");
      if (!raw) return null;
      const b64 = raw.startsWith("a1") ? raw.slice(2) : raw;
      try {
        const target = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        return /^https?:\/\//i.test(target) ? target : null;
      } catch {
        return null;
      }
    }
    return /^https?:\/\//i.test(full) ? full : null;
  } catch {
    return null;
  }
}

function curlHtml(url: string, timeoutMs: number): Promise<string | null> {
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const args = [
    "-sS",
    "-L",
    "--compressed",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    "-A",
    BROWSER_HEADERS["user-agent"],
    "-H",
    "accept-language: en-US,en;q=0.9",
    url,
  ];
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: timeoutMs + 4000 }, (err, stdout) => {
      resolve(err && !stdout ? null : stdout);
    });
  });
}

function parseBingHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    const href = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i)?.[1];
    const title = stripHtml(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
    if (!href || !title) continue;
    const target = unwrapBing(href);
    if (!target) continue;
    let key = target;
    try {
      const u = new URL(target);
      u.hash = "";
      key = u.toString();
    } catch {
      /* mantém a URL crua */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const snippet = stripHtml(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    hits.push({ title, url: target, snippet, engine: "Bing" });
  }
  return hits;
}

async function bingSearch(query: string): Promise<{ hits: SearchHit[]; note: string | null }> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=us`;
  let html = await curlHtml(url, SEARCH_TIMEOUT);
  if (!html) {
    try {
      const res = await fetchText(url, SEARCH_TIMEOUT, 700 * 1024, undefined, {
        "accept-language": "en-US,en;q=0.9",
      });
      if (res.status === 200) html = res.text;
    } catch (e) {
      return { hits: [], note: `Bing não respondeu (${(e as Error).message})` };
    }
  }
  if (!html) return { hits: [], note: "Bing não respondeu" };

  const hits = parseBingHtml(html);
  if (!hits.length) return { hits, note: "Bing não devolveu resultados para esta consulta" };
  return { hits, note: null };
}

function cleanMarkdown(text: string): string {
  return stripHtml(
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~\\]/g, "")
      .trim(),
  );
}

async function jinaDuckSearch(query: string): Promise<{ hits: SearchHit[]; note: string | null }> {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`;
  let res: { status: number; finalUrl: string; text: string };
  try {
    res = await fetchText(`https://r.jina.ai/${target}`, 30000, 700 * 1024, undefined, {
      accept: "text/plain",
    });
  } catch (e) {
    return { hits: [], note: `leitura do DuckDuckGo via r.jina.ai falhou (${(e as Error).message})` };
  }
  if (res.status !== 200) return { hits: [], note: `leitura via r.jina.ai respondeu HTTP ${res.status}` };
  if (/AbuseAlleviationError|blocked until/i.test(res.text.slice(0, 800))) {
    return { hits: [], note: "r.jina.ai recusou a consulta (limite de uso anônimo)" };
  }

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  let pending: { title: string; url: string; parts: string[] } | null = null;
  const flush = () => {
    if (!pending) return;
    const snippet = cleanMarkdown(pending.parts.join(" ")).slice(0, 400);
    let key = pending.url;
    try {
      const u = new URL(pending.url);
      u.hash = "";
      key = u.toString();
    } catch {
      /* mantém a URL crua */
    }
    if (!seen.has(key)) {
      seen.add(key);
      hits.push({ title: pending.title, url: pending.url, snippet, engine: "DuckDuckGo" });
    }
    pending = null;
  };
  for (const line of res.text.split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:\d+\.\s*)?##\s+\[(.+?)\]\((\S+?)\)\s*$/);
    if (heading) {
      flush();
      const url = unwrapDdg(heading[2]);
      if (url) pending = { title: cleanMarkdown(heading[1]), url, parts: [] };
    } else if (pending && line.trim()) {
      pending.parts.push(line);
    }
  }
  flush();

  if (!hits.length) return { hits, note: "DuckDuckGo via r.jina.ai não devolveu resultados" };
  return { hits, note: null };
}

async function searchWeb(
  query: string,
  skipDirectDdg = false,
): Promise<{ hits: SearchHit[]; note: string | null; ddgBlocked: boolean }> {
  const ddg = skipDirectDdg ? { hits: [] as SearchHit[], note: null } : await duckSearch(query);
  if (ddg.hits.length) return { hits: ddg.hits, note: ddg.note, ddgBlocked: false };

  const jina = await jinaDuckSearch(query);
  if (jina.hits.length) {
    const note = ddg.note ? `${ddg.note}; li os resultados via r.jina.ai` : null;
    return { hits: jina.hits, note, ddgBlocked: true };
  }

  const bing = await bingSearch(query);
  const note =
    [ddg.note, jina.note, bing.note, bing.hits.length ? "usei o Bing" : null].filter(Boolean).join("; ") || null;
  return { hits: bing.hits, note, ddgBlocked: true };
}

function extractPage(url: string, finalUrl: string, html: string): Page {
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const published =
    html.match(
      /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished)["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ??
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ??
    null;
  const links: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = decodeEntities(m[1]).trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try {
      links.push(new URL(href, finalUrl || url).toString());
    } catch {
      /* link inválido */
    }
    if (links.length >= 500) break;
  }
  return {
    ok: true,
    error: null,
    finalUrl: finalUrl || url,
    host: safeHost(finalUrl || url),
    title,
    published,
    text: stripHtml(html).slice(0, 320_000),
    links,
  };
}

async function fetchPage(url: string): Promise<Page> {
  if (!isPublicUrl(url)) {
    return { ok: false, error: "endereço não público", finalUrl: url, host: safeHost(url), title: "", published: null, text: "", links: [] };
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT),
      headers: BROWSER_HEADERS,
    });
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return {
        ok: false,
        error: `conteúdo ${type.split(";")[0]}`,
        finalUrl: res.url || url,
        host: safeHost(res.url || url),
        title: "",
        published: null,
        text: "",
        links: [],
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        finalUrl: res.url || url,
        host: safeHost(res.url || url),
        title: "",
        published: null,
        text: "",
        links: [],
      };
    }
    const html = await readCapped(res, MAX_PAGE_BYTES);
    return extractPage(url, res.url || url, html);
  } catch (e) {
    const err = e as Error;
    const error = err.name === "TimeoutError" || /aborted|timeout/i.test(err.message) ? "timeout" : err.message;
    return { ok: false, error, finalUrl: url, host: safeHost(url), title: "", published: null, text: "", links: [] };
  }
}

function extractFiles(text: string, links: string[]): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Za-z0-9][A-Za-z0-9._-]{3,}\.(?:img|zip))\b/gi)) {
    const name = m[1];
    if (name.length > 90) continue;
    if (/^(the|this|that|your|wrong|correct|factory|official|download|file|image|firmware|rom)\.(img|zip)$/i.test(name)) {
      continue;
    }
    out.add(name);
  }
  for (const link of links) {
    try {
      const name = decodeURIComponent(new URL(link).pathname.split("/").filter(Boolean).pop() ?? "");
      if (/\.(img|zip)$/i.test(name) && name.length <= 120) out.add(name);
    } catch {
      /* link inválido */
    }
  }
  return [...out].slice(0, 6);
}

function extractDownloads(links: string[]): string[] {
  const out = new Set<string>();
  for (const link of links) {
    if (
      /\.(img|zip)(\?|#|$)/i.test(link) ||
      /(mega\.nz|drive\.google\.com|mediafire\.com|yandex\.|dropbox\.com|terabox|pcloud|1drv\.ms|onedrive)/i.test(link)
    ) {
      out.add(link);
    }
  }
  return [...out].slice(0, 5);
}

function fileNamesFromHost(html: string): string[] {
  let text = decodeEntities(html);
  try {
    text = decodeURIComponent(text.replace(/%(?![0-9a-f]{2})/gi, "%25"));
  } catch {
    /* mantém o texto original */
  }
  const names = new Set<string>();
  for (const m of text.matchAll(/\b([A-Za-z0-9][A-Za-z0-9._() -]{2,90}\.(?:img|zip|rar|7z))\b/gi)) {
    const name = m[1].trim().replace(/\s+/g, " ");
    if (/^(index|file|download|firmware|rom|update|image|backup|test)\.(img|zip|rar|7z)$/i.test(name)) continue;
    names.add(name);
  }
  return [...names].slice(0, 8);
}

async function fileHostNames(url: string): Promise<string[]> {
  if (!isPublicUrl(url) || !FILE_HOST.test(url)) return [];
  try {
    const res = await fetchText(url, PAGE_TIMEOUT, MAX_PAGE_BYTES);
    if (res.status === 200) {
      const names = fileNamesFromHost(res.text);
      if (names.length) return names;
    }
  } catch {
    /* tenta pelo curl */
  }
  const html = await curlHtml(url, PAGE_TIMEOUT);
  return html ? fileNamesFromHost(html) : [];
}

function extractSoc(text: string): { soc: Candidate["soc"]; evidence: string[] } {
  const lower = text.toLowerCase();
  const evidence: string[] = [];
  if (lower.includes("sun50iw9")) evidence.push("sun50iw9");
  if (/\bh616\b/.test(lower)) evidence.push("H616");
  if (/\bh618\b/.test(lower)) evidence.push("H618");
  const h616 = evidence.length > 0;
  if (lower.includes("sun50iw6")) evidence.push("sun50iw6");
  if (/\bh6\b/.test(lower)) evidence.push("H6");
  const h6 = evidence.some((v) => v === "sun50iw6" || v === "H6");
  if (h616) return { soc: "sun50iw9", evidence };
  if (h6) return { soc: "sun50iw6", evidence };
  return { soc: "unknown", evidence };
}

function extractAndroid(text: string): string | null {
  const m = text.match(/android\s*([0-9]{1,2})(?:\.([0-9]+))?/i);
  if (!m) return null;
  const major = Number(m[1]);
  if (!major || major > 15) return null;
  return m[2] && m[2] !== "0" ? `${major}.${m[2]}` : String(major);
}

function dateFromParts(y: number, m: number, d: number): number | null {
  if (y < 2010 || y > 2030 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : ms;
}

function extractDates(
  title: string,
  snippet: string,
  filenames: string[],
  published: string | null,
): DateHit[] {
  const out: DateHit[] = [];
  const push = (ms: number | null, label: string) => {
    if (!ms) return;
    if (ms < Date.UTC(2010, 0, 1) || ms > Date.now() + 366 * 86400000) return;
    if (out.some((d) => Math.abs(d.ms - ms) < 86400000)) return;
    out.push({ ms, label });
  };

  if (published) {
    const ms = Date.parse(published);
    if (!Number.isNaN(ms)) push(ms, "publicado");
  }

  const titleDate = title.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (titleDate) {
    const a = Number(titleDate[1]);
    const b = Number(titleDate[2]);
    const y = Number(titleDate[3]);
    const d = a > 12 ? a : b > 12 ? b : a;
    const m = a > 12 ? b : b > 12 ? a : b;
    const ambiguous = a <= 12 && b <= 12;
    const raw = `${titleDate[1]}-${titleDate[2]}-${titleDate[3]}`;
    push(
      dateFromParts(y, m, d),
      ambiguous ? `data no título, dia/mês ambíguos em ${raw}` : "data no título",
    );
  }

  for (const m of `${title} ${snippet}`.matchAll(/\b(20\d{2})[-/.](\d{2})[-/.](\d{2})\b/g)) {
    push(dateFromParts(Number(m[1]), Number(m[2]), Number(m[3])), "data citada");
  }

  const titleYmd = title.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (titleYmd) push(dateFromParts(Number(titleYmd[1]), Number(titleYmd[2]), Number(titleYmd[3])), "data no título");

  for (const name of filenames) {
    const m = name.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
    if (m) push(dateFromParts(Number(m[1]), Number(m[2]), Number(m[3])), "data no arquivo");
  }

  out.sort((a, b) => b.ms - a.ms);
  return out.slice(0, 3);
}

function classify(host: string, vendor: string | null, text: string): { type: Candidate["official"]; why: string } {
  const h = host.toLowerCase();
  if (vendor && (h === vendor || h.endsWith(`.${vendor}`))) {
    return { type: "official", why: `domínio do OEM declarado pela box (${vendor})` };
  }
  const vendorHit = VENDOR_HOSTS.find((re) => re.test(h));
  if (vendorHit) return { type: "official", why: "domínio do fabricante/SoC" };
  const mirror = THIRD_PARTY_HOSTS.find(([re]) => re.test(h));
  if (mirror) return { type: "third-party", why: mirror[1] };
  if (/official\s+(firmware|rom)|firmware\s+oficial/i.test(text)) {
    return { type: "third-party", why: "o site se diz oficial, mas não é domínio do fabricante" };
  }
  return { type: "unknown", why: "origem não identificada" };
}

async function snapshot(device: DeviceTarget): Promise<Snapshot | null> {
  const [propsRaw, rootRaw, memRaw, uptimeRaw, dfRaw, partRaw, emmcRaw, updaterPath, updaterDump] =
    await Promise.all([
      sh(device, "getprop", 15000).catch(() => ""),
      sh(device, "id", 6000, true).catch(() => ""),
      sh(device, "cat /proc/meminfo", 6000).catch(() => ""),
      sh(device, "cat /proc/uptime", 6000).catch(() => ""),
      sh(device, "df -k /data", 8000).catch(() => ""),
      sh(device, "cat /proc/partitions", 8000).catch(() => ""),
      sh(device, "blockdev --getsize64 /dev/block/mmcblk0", 6000, true).catch(() => ""),
      sh(device, "pm path com.softwinner.update", 8000).catch(() => ""),
      sh(device, "dumpsys package com.softwinner.update", 15000).catch(() => ""),
    ]);

  const props = parseProps(propsRaw);
  if (props.size === 0) return null;

  const root = /\buid=0\b/.test(rootRaw);
  const [cert, checkin] = await Promise.all([readCert(device, root), readCheckin(device, root)]);

  const fp = prop(props, "ro.build.fingerprint");
  const fpParts = splitFingerprint(fp);
  const buildType = prop(props, "ro.build.type");
  const tags = prop(props, "ro.build.tags");
  const partitions = PARTITION_FPS.map(([name, key]) => [name, prop(props, key)] as [string, string]);
  const identity = identityFindings(props, fp, fpParts, partitions, buildType, tags);
  const maintainer = [...props].find(([key]) => /maintainer/i.test(key))?.[1] ?? "";
  const author = [prop(props, "ro.build.user"), prop(props, "ro.build.host")].filter(Boolean).join("@") || maintainer;

  const emmcFromProc = Number(partRaw.match(/^\s*\d+\s+\d+\s+(\d+)\s+mmcblk0\s*$/m)?.[1] ?? 0);
  const emmcBytes = Number(emmcRaw.trim()) || (emmcFromProc ? emmcFromProc * 1024 : null);
  const dfLine = dfRaw.trim().split(/\r?\n/).filter(Boolean).pop()?.trim().split(/\s+/) ?? [];
  const availableKb = Number(dfLine[3]);
  const availableBytes = Number.isFinite(availableKb) && availableKb > 0 ? availableKb * 1024 : null;
  const memTotalKb = Number(memRaw.match(/MemTotal:\s*(\d+)/)?.[1] ?? 0);
  const memAvailKb = Number(memRaw.match(/MemAvailable:\s*(\d+)/)?.[1] ?? 0);
  const uptimeSec = parseFloat(uptimeRaw.split(/\s+/)[0] ?? "0") || 0;

  return {
    props,
    root,
    model: prop(props, "ro.product.model"),
    manufacturer: prop(props, "ro.product.manufacturer"),
    brand: prop(props, "ro.product.brand"),
    device: prop(props, "ro.product.device"),
    board: prop(props, "ro.product.board"),
    hardware: prop(props, "ro.boot.hardware") || prop(props, "ro.hardware"),
    platform: prop(props, "ro.fota.platform") || prop(props, "ro.product.firmware"),
    oem: prop(props, "ro.fota.oem"),
    otaUrl: prop(props, "ro.product.otaupdateurl"),
    android: prop(props, "ro.build.version.release"),
    sdk: prop(props, "ro.build.version.sdk"),
    buildType,
    tags,
    fingerprint: fp,
    fpParts,
    partitions,
    identity,
    buildDate: prop(props, "ro.build.date"),
    buildUtc: Number(prop(props, "ro.build.date.utc")) * 1000 || null,
    incremental: prop(props, "ro.build.version.incremental"),
    fota: prop(props, "ro.fota.version"),
    description: prop(props, "ro.build.description"),
    patch: prop(props, "ro.build.version.security_patch"),
    author,
    emmcBytes,
    availableBytes,
    memTotalKb,
    memAvailKb,
    uptimeSec,
    updater: Boolean(updaterPath.trim()) && /android\.uid\.system/.test(updaterDump),
    certRaw: cert.status,
    certIssued: cert.issued,
    certExpires: cert.expires,
    gsfId: checkin.gsfId,
    checkinTime: checkin.time,
  };
}

function searchQueries(s: Snapshot): string[] {
  const model = s.model.replace(/_+/g, " ").trim() || `${s.brand} TV box`.trim();
  const soc = /sun50iw9|h616|h618/i.test(`${s.hardware} ${s.platform} ${s.board}`) ? "H616" : "";
  const parts = [model, soc, s.android ? `Android ${s.android}` : "", "firmware download"].filter(Boolean);
  const first = [...new Set(parts.join(" ").split(/\s+/))].join(" ");
  const vendor = vendorDomain(s.otaUrl);
  const second = vendor ? `${vendor} ${s.model.replace(/_+/g, " ")} firmware` : `${s.manufacturer} TV box firmware`;
  return [...new Set([first, second])];
}

function preScore(hit: SearchHit): number {
  const text = `${hit.title} ${hit.snippet}`.toLowerCase();
  let score = 0;
  if (/h616|h618|sun50iw9/.test(text)) score += 12;
  if (/transpeed/.test(text)) score += 8;
  if (/\bh6\b|sun50iw6/.test(text)) score -= 10;
  if (/firmware|rom|update|download/.test(text)) score += 4;
  if (/official|oficial/.test(text)) score += 2;
  return score;
}

function buildCandidate(
  hit: SearchHit,
  page: Page | null,
  s: Snapshot,
  vendor: string | null,
  linkFiles: string[] = [],
): Candidate {
  const text = [page?.text ?? "", hit.title, hit.snippet].join(" ");
  const lower = text.toLowerCase();
  const { soc, evidence } = extractSoc(text);
  const android = extractAndroid(text);
  const modelHuman = s.model.replace(/_+/g, " ").toLowerCase();
  const exactModel = Boolean(s.model) && lower.includes(s.model.toLowerCase());
  const humanModel = Boolean(modelHuman) && modelHuman.length >= 5 && lower.includes(modelHuman);
  const transpeedH616 = lower.includes("transpeed") && /h616|h618|\b6k\b/.test(lower);
  const modelMatch = exactModel || humanModel || transpeedH616;
  const otherModel =
    /\b(t95|x96|tanix|h96|mx10|vontar|hk1|h40)\b/i.test(text) && !/transpeed/i.test(text);
  const filenames = extractFiles(text, page?.links ?? []);
  const downloads = extractDownloads(page?.links ?? []);
  const fileText = linkFiles.join(" ").toLowerCase();
  const filesH616 = /h616|h618|sun50iw9/.test(fileText);
  const files6K = /transpeed[_ -]?6k/.test(fileText) && !filesH616;
  const dates = extractDates(hit.title, hit.snippet, [...filenames, ...linkFiles], page?.published ?? null);
  const host = page?.host || safeHost(hit.url);
  const cls = classify(host, vendor, text);

  const warnings: string[] = [];
  if (soc === "sun50iw6") warnings.push("a página aponta SoC H6 (sun50iw6), incompatível com o H616 da box");
  if (otherModel) warnings.push("a página cita outro modelo (T95/X96/Tanix etc.), não o Transpeed");
  if (android && s.android && android !== s.android) warnings.push(`Android ${android} na página; a box é Android ${s.android}`);
  if (page && !page.ok && page.error) warnings.push(`não consegui ler a página (${page.error})`);
  if (page?.ok && !downloads.length) warnings.push("a página não expõe link direto de download");
  if (files6K) {
    warnings.push(
      "os arquivos do link são da linha Transpeed_6K, sem H616 no nome; builds 6K de 2020 usam sun50iw6p1 (H6)",
    );
  }

  let compatible: Candidate["compatible"] = "check";
  let compatibilityWhy = "a página não declara a placa; confirme o arquivo antes de instalar";
  if (soc === "sun50iw6") {
    compatible = "no";
    compatibilityWhy = "SoC H6 (sun50iw6): não serve no H616";
  } else if (soc === "sun50iw9") {
    if (files6K && !/6k/i.test(s.model)) {
      compatible = "check";
      compatibilityWhy =
        "a página declara H616, mas os arquivos do link são Transpeed_6K sem H616 no nome: a placa não está confirmada";
    } else {
      compatible = "yes";
      compatibilityWhy = `H616/sun50iw9 declarado${modelMatch ? " e modelo Transpeed citado" : ""}${
        filesH616 ? "; arquivo do link cita H616" : ""
      }`;
    }
  } else if (modelMatch) {
    compatibilityWhy = "modelo Transpeed citado, mas o SoC não está declarado";
  }

  const candidate: Candidate = {
    hit,
    page,
    host,
    soc,
    socEvidence: evidence,
    android,
    modelMatch,
    otherModel,
    filenames,
    linkFiles,
    downloads,
    dates,
    official: cls.type,
    officialWhy: cls.why,
    warnings,
    compatible,
    compatibilityWhy,
    score: 0,
  };

  let score = 0;
  if (compatible === "no") score = -1000;
  else {
    score += compatible === "yes" ? 50 : 0;
    if (modelMatch) score += 30;
    else if (cls.type !== "official") score -= 15;
    if (otherModel) score -= 20;
    if (filesH616) score += 10;
    if (files6K && soc === "sun50iw9") score -= 20;
    if (android && s.android && android === s.android) score += 10;
    if (filenames.length || linkFiles.length) score += 6;
    if (downloads.length) score += 12;
    else score -= 12;
    if (page?.ok) score += 4;
    if (cls.type === "official") score += 25;
    else if (cls.type === "unknown") score += 2;
    const date = bestDate(candidate)?.ms;
    if (date) {
      const d = new Date(date);
      score += Math.min(12, Math.max(0, (d.getUTCFullYear() - 2018) * 2 + d.getUTCMonth() / 6));
    }
  }
  candidate.score = score;
  return candidate;
}

function bestDate(c: Candidate): DateHit | null {
  return (
    c.dates.find((d) => /arquivo|título|citada/.test(d.label) && !/ambígu/.test(d.label)) ??
    c.dates.find((d) => /arquivo|título|citada/.test(d.label)) ??
    c.dates[0] ??
    null
  );
}

function firmwareDate(c: Candidate): DateHit | null {
  return c.dates.find((d) => /arquivo|título|citada/.test(d.label) && !/ambígu/.test(d.label)) ?? null;
}

function isRelevant(c: Candidate): boolean {
  const text = `${c.hit.title} ${c.hit.snippet} ${c.page?.text ?? ""}`.toLowerCase();
  if (/transpeed|h616|h618|sun50iw9|sun50iw6|\bh6\b/.test(text)) return true;
  return /allwinner/.test(text) && /firmware|\brom\b|flash/.test(text);
}

function rejectReason(c: Candidate): string {
  if (c.compatible === "no") return c.compatibilityWhy;
  if (!c.modelMatch) return "é H616/H6, mas não é específica do Transpeed_H616";
  if (!c.downloads.length) return "a página não tem link de download utilizável";
  return "pontuação insuficiente";
}

function officialLabel(c: Candidate): string {
  if (c.official === "official") return "OFICIAL";
  if (c.official === "third-party") return "TERCEIRO";
  return "INDETERMINADO";
}

function socLabel(c: Candidate): string {
  if (c.soc === "sun50iw9" && c.compatible === "check") return "H616 (declarado na página, não confirmado)";
  const short = c.soc === "sun50iw9" ? "H616" : c.soc === "sun50iw6" ? "H6" : null;
  if (!short) return "não declarado";
  const extra = c.socEvidence.filter((e) => e.toLowerCase() !== short.toLowerCase());
  return extra.length ? `${short} (${extra.join(", ")})` : short;
}

function candidateLines(index: number, c: Candidate): string[] {
  const date = bestDate(c);
  const file = c.filenames.length ? c.filenames.join(", ") : "não declarado na página";
  const download = c.downloads[0] ?? "sem link direto (procure o botão de download na página)";
  const why = [c.compatibilityWhy, c.officialWhy, ...c.warnings].filter(Boolean).join("; ");
  const lines = [
    `${index}. [${officialLabel(c)}] ${c.hit.title.slice(0, 110)}`,
    `   Fonte    : ${c.host} — ${c.officialWhy}`,
    `   Placa    : ${socLabel(c)}${c.android ? ` · Android ${c.android}` : ""}`,
    `   Data     : ${date ? `${fmtDay(date.ms)} (${date.label})` : "não declarada"}`,
    `   Arquivo  : ${file}`,
  ];
  if (c.linkFiles.length) {
    const names = c.linkFiles.slice(0, 4).join(", ");
    const more = c.linkFiles.length > 4 ? ` (+${c.linkFiles.length - 4})` : "";
    lines.push(`   No link  : ${names}${more}`);
  }
  lines.push(
    `   Download : ${download}`,
    `   Link     : ${c.hit.url}`,
    `   Avaliação: ${why}`,
    `   Pontos   : ${Math.round(c.score)}`,
  );
  return lines;
}

function deviceLines(device: DeviceTarget, s: Snapshot): string[] {
  const fpParts = s.fpParts;
  const partitionValues = [...new Set(s.partitions.map(([, value]) => value).filter(Boolean))];
  const node = prop(s.props, "ro.product.name") || s.device;
  const buildUtc = s.buildUtc ? fmtDay(s.buildUtc) : null;
  const uptimeDays = Math.floor(s.uptimeSec / 86400);
  const uptimeHours = Math.floor((s.uptimeSec % 86400) / 3600);
  const uptime = [uptimeDays ? `${uptimeDays}d` : "", uptimeHours ? `${uptimeHours}h` : ""].filter(Boolean).join(" ") || "?";
  const certLabel = statusLabel(s.certRaw);
  const certDate = s.certIssued ? fmtDate(s.certIssued) : null;

  const lines = [
    `${device.ip} — scan de firmware (ADB + internet)`,
    "",
    "── Aparelho (list + play) ──────────────",
    `  Modelo      : ${s.model || "?"}${s.manufacturer ? ` (${s.manufacturer})` : ""} · device ${node || "?"}`,
    `  Placa       : ${s.hardware || s.board || "?"} · ${s.platform || s.board || "?"}`,
    `  Android     : ${s.android || "?"} (SDK ${s.sdk || "?"})`,
    `  Build       : ${s.buildType || "?"} / ${s.tags || "?"} · ${s.incremental || "?"}`,
    `  Compilada   : ${s.buildDate || "?"}${buildUtc ? ` (${buildUtc} UTC)` : ""}`,
    `  FOTA        : ${s.fota || "?"}`,
    `  Autor       : ${s.author || "não declarado"}`,
    `  Fingerprint : ${s.fingerprint || "?"}`,
  ];

  if (fpParts) {
    lines.push(
      `                marca ${fpParts.brand} · produto ${fpParts.product} · device ${fpParts.device} · ${fpParts.release}/${fpParts.id}/${fpParts.incremental || "(sem incremental)"} · ${fpParts.type}/${fpParts.tags}`,
    );
  }
  if (partitionValues.length) {
    lines.push(
      `  Partições   : ${s.partitions.filter(([, value]) => value).map(([name]) => name).join("/")} → ${partitionValues.join(" | ")}`,
    );
  }
  lines.push(
    `  OEM / OTA   : ${s.oem || "?"}${s.otaUrl ? ` · ${s.otaUrl}` : " · URL de OTA não declarada"}`,
    `  eMMC        : ${fmtBytes(s.emmcBytes)} · livre /data ${fmtBytes(s.availableBytes)}${
      s.emmcBytes && s.availableBytes && s.availableBytes > s.emmcBytes
        ? " (df inconsistente: maior que o eMMC)"
        : ""
    }`,
    `  Memória     : ${s.memTotalKb ? `${Math.round(s.memTotalKb / 1024)} MB` : "?"} total · ${
      s.memAvailKb ? `${Math.round(s.memAvailKb / 1024)} MB` : "?"
    } disponível`,
    `  Uptime      : ${uptime}`,
    `  Root        : ${s.root ? "sim" : "não"} · Local Update: ${s.updater ? "sim" : "não"}`,
    `  Play        : ${certLabel}${s.gsfId ? ` · GSF ID ${s.gsfId}` : ""}${certDate ? ` · veredito ${certDate}` : ""}`,
  );

  if (s.identity.length) {
    lines.push("", "  Desvios de identidade (play):");
    for (const item of s.identity) lines.push(`  • ${item}`);
  }
  return lines;
}

function searchSummary(
  queries: string[],
  hits: SearchHit[],
  relevant: number,
  pages: number,
  failures: number,
  notes: string[],
  limit: number,
): string[] {
  const engines = [...new Set(hits.map((h) => h.engine))].join(" + ") || "DuckDuckGo + Bing";
  return [
    "── Busca na internet ───────────────────",
    `  Consultas   : ${queries.map((q) => `"${q}"`).join(" · ")}`,
    `  Motor       : ${engines}`,
    `  Resultados  : ${hits.length} (${relevant} de firmware) · páginas lidas: ${pages} · falhas: ${failures}`,
    `  Limite      : ${limit} (1 mostra só o melhor; use 5 para ver mais)`,
    ...(notes.length ? [`  Avisos      : ${notes.join("; ")}`] : []),
  ];
}

function recommendationLines(top: Candidate | undefined, s: Snapshot, limit: number): string[] {
  const confirmed = Boolean(top && top.compatible === "yes");
  const lines = [confirmed ? "── Melhor ROM encontrada ───────────────" : "── Nenhuma ROM confirmada ──────────────"];
  if (!top) {
    lines.push(
      "  Nenhuma ROM compatível apareceu nas fontes consultadas.",
      "",
      "  O que dá para fazer:",
      `  • a própria box declara o canal oficial ${s.otaUrl || "(sem ro.product.otaupdateurl)"};`,
      "    é o endereço que o app com.softwinner.update consulta. O scan não acessa esse",
      "    endpoint; a atualização oficial depende da rede da box.",
      "  • procure o modelo no site do OEM e peça o firmware ao suporte;",
      `  • busca manual: https://duckduckgo.com/html/?q=${encodeURIComponent(`${s.model} firmware`)}`,
      "  • quando tiver o arquivo, coloque em roms/ e rode update firmware para validar.",
    );
    return lines;
  }

  if (!confirmed) {
    lines.push(
      "  O melhor resultado é uma pista, não uma ROM confirmada: a placa não foi",
      "  comprovada pelo nome do arquivo. Não grave nada sem rodar o update firmware",
      "  para ler o SoC de dentro do arquivo (a página pode errar a placa).",
      "",
    );
  }

  const date = bestDate(top);
  const fwDate = firmwareDate(top);
  const older =
    fwDate && s.buildUtc && fwDate.ms + 30 * 86400000 < s.buildUtc
      ? `a data do firmware (${fmtDay(fwDate.ms)}) é anterior à build instalada (${fmtDay(s.buildUtc)}).`
      : null;

  lines.push(
    `  ${top.hit.title}`,
    `  Fonte      : ${top.host} — ${officialLabel(top)} (${top.officialWhy})`,
    `  Placa      : ${socLabel(top)}${top.android ? ` · Android ${top.android}` : ""}`,
    `  Data       : ${date ? `${fmtDay(date.ms)} (${date.label})` : "não declarada"}`,
    `  Arquivo    : ${top.filenames.length ? top.filenames.join(", ") : "não declarado na página"}`,
  );
  if (top.linkFiles.length) {
    const names = top.linkFiles.slice(0, 4).join(", ");
    const more = top.linkFiles.length > 4 ? ` (+${top.linkFiles.length - 4})` : "";
    lines.push(`  No link    : ${names}${more}`);
  }
  lines.push(
    `  Download   : ${top.downloads[0] ?? "sem link direto; abra a página e procure o botão de download"}`,
    `  Link       : ${top.hit.url}`,
  );
  if (top.warnings.length) lines.push(`  Aviso      : ${top.warnings.join("; ")}`);
  if (older) lines.push(`  Observação : ${older}`);
  if (top.official !== "official") {
    lines.push(
      "  Origem     : a ROM não está em domínio do fabricante. O arquivo pode ser o original",
      "               da fábrica, mas isso só o update firmware confere (SoC, cabeçalho",
      "               Allwinner, identidade, assinatura e SHA-256).",
    );
  }
  lines.push(
    "",
    "  Como usar (nada é baixado nem instalado por este comando):",
    `    1. baixe o arquivo e coloque em roms/ (ou use a pasta indicada por TX_ROMS_DIR);`,
    `    2. update firmware ${"<alvo>"} list`,
    `    3. update firmware ${"<alvo>"} <arquivo>`,
    `    4. update firmware ${"<alvo>"} <arquivo> confirmar`,
    "",
    "  Instalação : o update firmware instala OTA .zip assinado sozinho;",
    "               imagem completa (.img/.rar ou .zip com .img) ele recusa e",
    "               termina com NADA FOI INSTALADO — não finge sucesso.",
    "",
    "  A classificação oficial x terceiro é feita pelo domínio/origem do resultado;",
    "  não é possível verificar a assinatura criptográfica do firmware a partir da busca.",
    confirmed
      ? "  A placa foi confirmada pelo nome do arquivo; ainda assim, o update firmware relê o conteúdo."
      : "  Nenhum candidato teve a placa confirmada pelo nome do arquivo; trate todos como pistas.",
  );
  return lines;
}

function notesLines(s: Snapshot): string[] {
  const lines: string[] = [];
  const vendor = vendorDomain(s.otaUrl);
  if (vendor) {
    lines.push(
      "── Canal oficial da box ────────────────",
      `  OEM         : ${s.oem || "?"} · ${s.platform || "?"}${vendor ? ` · ${vendor}` : ""}`,
      `  OTA         : ${s.otaUrl}`,
      "  Situação    : esse é o canal que o app com.softwinner.update usa. O scan não",
      "                consulta esse endpoint; a atualização oficial depende da rede da box.",
    );
  }
  return lines;
}

export async function scanFirmware(device: DeviceTarget, limit = 3): Promise<{ ok: boolean; output: string }> {
  const s = await snapshot(device);
  if (!s) {
    return {
      ok: false,
      output: `${device.endpoint}: o aparelho respondeu ao ADB mas não devolveu as propriedades do sistema.`,
    };
  }

  const queries = searchQueries(s);
  const notes: string[] = [];
  let hits: SearchHit[] = [];

  const first = await searchWeb(queries[0], false);
  hits = first.hits;
  if (first.note && !notes.includes(first.note)) notes.push(first.note);

  const vendor = vendorDomain(s.otaUrl);
  const hasVendorHit = hits.some((h) => {
    const host = safeHost(h.url);
    return Boolean(vendor && (host === vendor || host.endsWith(`.${vendor}`))) || VENDOR_HOSTS.some((re) => re.test(host));
  });
  if (queries[1] && (!hits.length || !hasVendorHit)) {
    await delay(2000);
    const second = await searchWeb(queries[1], first.ddgBlocked);
    if (second.note && !notes.includes(second.note)) notes.push(second.note);
    const seen = new Set(hits.map((h) => h.url));
    for (const hit of second.hits) {
      if (!seen.has(hit.url)) {
        hits.push(hit);
        seen.add(hit.url);
      }
    }
  }
  hits = hits.slice(0, 24);

  const rankedHits = [...hits].sort((a, b) => preScore(b) - preScore(a));
  const pageHosts = new Map<string, number>();
  const toFetch: SearchHit[] = [];
  for (const hit of rankedHits) {
    const host = safeHost(hit.url);
    if (!host) continue;
    const count = pageHosts.get(host) ?? 0;
    if (count >= 2) continue;
    pageHosts.set(host, count + 1);
    toFetch.push(hit);
    if (toFetch.length >= MAX_PAGES) break;
  }

  const fetched = await Promise.all(toFetch.map(async (hit) => [hit, await fetchPage(hit.url)] as const));
  const pageMap = new Map<string, Page>();
  let failures = 0;
  for (const [hit, page] of fetched) {
    pageMap.set(hit.url, page);
    if (!page.ok) failures += 1;
  }
  const pagesRead = fetched.filter(([, page]) => page.ok).length;

  const linkFiles = new Map<string, string[]>();
  const hostCache = new Map<string, Promise<string[]>>();
  const pendingLinks = new Set<string>();
  const linkTasks: Array<Promise<void>> = [];
  for (const hit of toFetch) {
    const page = pageMap.get(hit.url);
    if (!page?.ok) continue;
    const links = extractDownloads(page.links).filter((link) => FILE_HOST.test(link)).slice(0, 2);
    for (const link of links) {
      if (!pendingLinks.has(link) && pendingLinks.size >= 4) continue;
      pendingLinks.add(link);
      linkTasks.push(
        (async () => {
          let names = hostCache.get(link);
          if (!names) {
            names = fileHostNames(link);
            hostCache.set(link, names);
          }
          const found = await names;
          if (!found.length) return;
          const merged = new Set([...(linkFiles.get(hit.url) ?? []), ...found]);
          linkFiles.set(hit.url, [...merged]);
        })(),
      );
    }
  }
  await Promise.all(linkTasks);

  const candidates = hits.map((hit) =>
    buildCandidate(hit, pageMap.get(hit.url) ?? null, s, vendor, linkFiles.get(hit.url) ?? []),
  );
  const relevant = candidates.filter(isRelevant);
  const eligible = relevant
    .filter(
      (c) =>
        c.compatible !== "no" &&
        (c.modelMatch || c.official === "official") &&
        c.score > 0 &&
        (c.downloads.length > 0 || c.official === "official"),
    )
    .sort((a, b) => b.score - a.score);
  const blocked = relevant
    .filter((c) => !eligible.includes(c))
    .sort((a, b) => a.hit.title.localeCompare(b.hit.title));
  const shown = eligible.slice(0, Math.max(1, limit));
  const officialNotes = notesLines(s);

  const lines = [
    ...deviceLines(device, s),
    "",
    ...searchSummary(queries, hits, relevant.length, pagesRead, failures, notes, limit),
    "",
    ...officialNotes,
    ...(officialNotes.length ? [""] : []),
    "── Candidatos ──────────────────────────",
  ];

  if (shown.length) {
    shown.forEach((c, i) => {
      lines.push(...candidateLines(i + 1, c), "");
    });
  } else {
    lines.push(
      relevant.length
        ? `  nenhum candidato compatível entre ${relevant.length} resultado(s) de firmware.`
        : `  nenhum dos ${hits.length} resultados era de firmware para este hardware.`,
      "",
    );
  }

  if (blocked.length) {
    lines.push("── Descartados ─────────────────────────");
    for (const c of blocked.slice(0, 5)) {
      lines.push(`  • ${c.hit.title.slice(0, 90)} — ${rejectReason(c)}`);
      lines.push(`    ${c.hit.url}`);
    }
    lines.push("");
  }

  lines.push(...recommendationLines(shown[0], s, limit), "");

  return { ok: true, output: lines.join("\n") };
}
