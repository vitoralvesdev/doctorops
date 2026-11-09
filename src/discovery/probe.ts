import dgram from "node:dgram";
import net from "node:net";
import { adbConnect } from "../adb/client.js";
import { knownHosts, saveHosts } from "../core/host-cache.js";
import { logFound, logStep } from "../core/log.js";
import { getMacFromArp, pingTtl, portOpen, reverseName } from "../core/network.js";
import { isLocallyAdministeredMac, lookupOui } from "./oui.js";
import { DEEP_PORTS, PORT_LABELS } from "./ports.js";

export type ProbePort = { port: number; label: string; server?: string; title?: string; auth?: string; snippet?: string };

export type DeepProbeResult = {
  ip: string;
  mac: string | null;
  ouiVendor: string | null;
  ouiNote: string | null;
  localMac: boolean;
  ttl: number | null;
  hostname: string | null;
  open: ProbePort[];
  scanned: number;
  udp: string[];
  adbState: string | null;
  verdict: string[];
  tookMs: number;
};

const HTTP_GET_PORTS = new Set([80, 7547, 8008, 8080, 8081, 8082, 8888, 9000, 9009, 9080, 19999]);

async function scanPorts(ip: string, ports: number[], concurrency: number, timeout: number): Promise<number[]> {
  const open: number[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ports.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= ports.length) break;
        const port = ports[i];
        if (await portOpen(ip, port, timeout)) open.push(port);
      }
    }),
  );
  return open.sort((a, b) => a - b);
}

function grab(ip: string, port: number, timeoutMs = 1400): Promise<string> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(buffer);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      try {
        if (HTTP_GET_PORTS.has(port)) {
          socket.write(`GET / HTTP/1.0\r\nHost: ${ip}\r\nUser-Agent: tx-box-port-probe\r\nConnection: close\r\n\r\n`);
        } else if (port === 7000) {
          socket.write("OPTIONS * RTSP/1.0\r\nCSeq: 1\r\n\r\n");
        }
      } catch {
        /* banner passivo */
      }
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.length >= 2048) finish();
    });
    socket.once("timeout", finish);
    socket.once("error", finish);
    socket.once("close", finish);
    socket.connect(port, ip);
    setTimeout(finish, timeoutMs + 400);
  });
}

function parseHttp(raw: string): Pick<ProbePort, "server" | "title" | "auth" | "snippet"> {
  const server = raw.match(/^server:\s*([^\r\n]+)/im)?.[1]?.trim();
  const title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const auth = raw.match(/^www-authenticate:\s*([^\r\n]+)/im)?.[1]?.trim();
  const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n");
  const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  return { server, title, auth, snippet: snippet || undefined };
}

function udpCollect(
  dest: string,
  port: number,
  payloads: Buffer[],
  ip: string,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const replies: string[] = [];
    socket.on("message", (msg, rinfo) => {
      if (rinfo.address !== ip) return;
      const text = msg.toString("latin1").replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
      if (text) replies.push(text.slice(0, 300));
    });
    socket.on("error", () => resolve([]));
    socket.bind(0, () => {
      for (const payload of payloads) {
        try {
          socket.send(payload, port, dest);
        } catch {
          /* protocolo indisponível */
        }
      }
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* já fechado */
        }
        resolve(replies);
      }, timeoutMs);
    });
  });
}

function dnsName(name: string): Buffer {
  const parts = name.replace(/\.$/, "").split(".");
  return Buffer.concat([
    ...parts.map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)])),
    Buffer.from([0]),
  ]);
}

function mdnsQuery(service: string): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    dnsName(service),
    Buffer.from([0, 12, 0, 1]),
  ]);
}

async function udpProbes(ip: string): Promise<string[]> {
  const out: string[] = [];
  const ssdp = Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: ssdp:all",
      "",
      "",
    ].join("\r\n"),
  );
  const ssdpReplies = await udpCollect("239.255.255.250", 1900, [ssdp, ssdp], ip, 2600);
  out.push(ssdpReplies.length ? `SSDP respondeu: ${ssdpReplies[0]}` : "SSDP: sem resposta");

  const services = [
    "_googlecast._tcp.local",
    "_androidtvremote2._tcp.local",
    "_androidtvremote._tcp.local",
    "_airplay._tcp.local",
    "_raop._tcp.local",
    "_adb._tcp.local",
    "_adb-tls-connect._tcp.local",
    "_http._tcp.local",
  ];
  const mdnsReplies = await udpCollect("224.0.0.251", 5353, services.map(mdnsQuery), ip, 3200);
  if (mdnsReplies.length) {
    const names = [...new Set(mdnsReplies.join(" ").match(/[A-Za-z0-9_.-]{4,}\.local/g) ?? [])].slice(0, 6);
    out.push(`mDNS respondeu${names.length ? `: ${names.join(", ")}` : ""}`);
  } else {
    out.push("mDNS: sem resposta");
  }

  const nbstat = Buffer.concat([
    Buffer.from([0x82, 0x28, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x20]),
    Buffer.from("CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ascii"),
    Buffer.from([0x00, 0x00, 0x21, 0x00, 0x01]),
  ]);
  const netbios = await udpCollect(ip, 137, [nbstat], ip, 2200);
  out.push(netbios.length ? `NetBIOS respondeu: ${netbios[0]}` : "NetBIOS: sem resposta");
  return out;
}

export async function deepProbe(ip: string, opts: { full?: boolean } = {}): Promise<DeepProbeResult> {
  const started = Date.now();
  const ports = opts.full ? Array.from({ length: 65535 }, (_, i) => i + 1) : DEEP_PORTS;
  logStep(`probe ${ip} — ${opts.full ? "varredura completa (1-65535)" : `${ports.length} portas`}…`);

  const [mac, ttl, hostname, openPorts] = await Promise.all([
    getMacFromArp(ip),
    pingTtl(ip),
    reverseName(ip),
    scanPorts(ip, ports, opts.full ? 500 : 32, opts.full ? 350 : 600),
  ]);

  const open: ProbePort[] = [];
  for (const port of openPorts) {
    const raw = await grab(ip, port);
    open.push({ port, label: PORT_LABELS[port] ?? "TCP", ...parseHttp(raw) });
  }
  if (open.length) logFound(`probe ${ip}: ${open.map((p) => `${p.label}:${p.port}`).join(", ")}`);
  else logFound(`probe ${ip}: nenhuma porta TCP aberta nas ${ports.length} testadas`);

  const udp = ttl === null && !mac ? [] : await udpProbes(ip);
  const oui = lookupOui(mac);
  const localMac = isLocallyAdministeredMac(mac);
  const adbPort = open.find((p) => p.port === 5555);
  const adbState = adbPort ? await adbConnect(`${ip}:5555`) : null;

  const verdict: string[] = [];
  verdict.push(
    mac
      ? `MAC ${mac}${oui ? ` — ${oui.vendor}${oui.note ? ` (${oui.note})` : ""}` : localMac ? " — MAC privado/aleatório, não identifica fabricante" : " — OUI fora da base local"}`
      : "MAC não encontrado na tabela ARP (aparelho pode estar dormindo).",
  );
  if (ttl !== null) verdict.push(`TTL ${ttl} — ${ttl <= 64 ? "família Linux/Android" : "família Windows/rede"}.`);
  else verdict.push("Sem resposta ao ping: pode estar dormindo ou bloquear ICMP.");

  if (adbPort) {
    verdict.push(
      adbState === "device"
        ? "ADB TCP está ativo e autorizado na porta 5555."
        : `ADB TCP está ativo na porta 5555 (estado: ${adbState ?? "sem resposta"}).`,
    );
  } else {
    verdict.push("ADB TCP (5555) fechado: a depuração remota está desligada na firmware.");
    verdict.push("Não há criptografia a quebrar — o adbd simplesmente não está escutando na rede.");
  }
  if (!open.length && ttl !== null) {
    verdict.push("Nenhum serviço TCP/UDP anunciado: assinatura típica de Android 9/10 com ADB só por USB.");
  }

  const h = knownHosts[ip] ?? { ip, ports: [], lastSeen: "" };
  h.ports = [...new Set([...h.ports, ...openPorts])].sort((a, b) => a - b);
  h.openPorts = openPorts;
  h.lastSeen = new Date().toISOString();
  h.lastProbe = h.lastSeen;
  if (mac) h.mac = mac;
  if (oui) h.vendor = oui.vendor;
  if (hostname && hostname !== ip) h.name = hostname;
  knownHosts[ip] = h;
  saveHosts(knownHosts);

  return {
    ip,
    mac,
    ouiVendor: oui?.vendor ?? null,
    ouiNote: oui?.note ?? null,
    localMac,
    ttl,
    hostname,
    open,
    scanned: ports.length,
    udp,
    adbState,
    verdict,
    tookMs: Date.now() - started,
  };
}

export function formatProbe(r: DeepProbeResult): string {
  const lines: string[] = [
    `Probe ${r.ip} — ${(r.tookMs / 1000).toFixed(1)}s, ${r.scanned} porta(s) TCP testada(s)`,
    "",
    "── Identificação ──────────────────────",
    `  MAC        : ${r.mac ?? "desconhecido"}`,
    `  Módulo     : ${r.ouiVendor ?? (r.localMac ? "MAC privado" : "não identificado")}${r.ouiNote ? ` — ${r.ouiNote}` : ""}`,
    `  TTL        : ${r.ttl ?? "sem resposta"}`,
    `  Nome DNS   : ${r.hostname ?? "(nenhum)"}`,
    `  ADB 5555   : ${r.open.some((p) => p.port === 5555) ? `aberto${r.adbState ? ` (${r.adbState})` : ""}` : "fechado"}`,
    "",
    "── Serviços ───────────────────────────",
  ];

  if (r.open.length) {
    for (const p of r.open) {
      const extras = [p.title, p.server, p.auth].filter(Boolean).join(" | ");
      lines.push(`  • ${p.label}:${p.port}${extras ? ` — ${extras}` : ""}`);
      if (p.snippet) lines.push(`    ${p.snippet}`);
    }
  } else {
    lines.push("  Nenhuma porta TCP aberta.");
  }
  for (const u of r.udp) lines.push(`  ${u}`);

  lines.push("", "── Leitura ────────────────────────────");
  for (const v of r.verdict) lines.push(`  - ${v}`);

  lines.push(
    "",
    "── Como liberar ADB de rede ───────────",
    "  1. Com porta OTG USB: conecte o cabo e rode `tcpip <serial>`.",
    "     Se a caixa só tem USB-A HOST, nenhum cabo USB resolve — use UART ou cartão SD.",
    "  2. Sem OTG: console UART 3.3V (USB-TTL) no header da placa → shell root →",
    "     setprop persist.adb.tcp.port 5555 → reinicie o adbd.",
    "  3. Sem OTG: repack da ROM stock com persist.adb.tcp.port=5555 e flash por cartão SD.",
    "  Android 11+ com 'Depuração sem fio' não existe em ROM stock H6/H616;",
    "  ROM de H618 não é compatível e brickaria a placa.",
  );

  return lines.join("\n");
}
