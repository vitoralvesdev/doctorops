import type { DeviceTarget } from "./ops.js";
import { run } from "./client.js";
import { delay } from "../core/time.js";

const CHECKIN_XML = "/data/data/com.google.android.gms/shared_prefs/Checkin.xml";

const PARTITION_FPS: Array<[string, string]> = [
  ["system", "ro.system.build.fingerprint"],
  ["vendor", "ro.vendor.build.fingerprint"],
  ["product", "ro.product.build.fingerprint"],
  ["odm", "ro.odm.build.fingerprint"],
  ["boot", "ro.bootimage.build.fingerprint"],
];

const BUILD_PROP_FILES = [
  "/system/build.prop",
  "/system/etc/prop.default",
  "/vendor/build.prop",
  "/product/build.prop",
  "/odm/build.prop",
];

const ROM_PROP_KEY =
  /(maintainer|modversion|romversion|^ro\.rom\.|lineage\.|havoc\.|crdroid\.|aicp\.|omni\.|resurrection\.|evolution\.|arrow\.|bliss\.|superior\.|potato\.|corvus\.|nusantara\.|voltage\.|cherish\.|xtended\.|pixelexperience\.|paranoid\.|aospa\.|unofficial|official|build\.version\.ota)/i;

type Status = "certified" | "uncertified" | "unknown";

type CertState = {
  status: string | null;
  expires: number | null;
  remaining: number | null;
  issued: number | null;
};

type PkgInfo = {
  version: string | null;
  installed: string | null;
  updated: string | null;
  factory: string | null;
};

type PropMap = Map<string, string>;

type Fingerprint = {
  brand: string;
  product: string;
  device: string;
  release: string;
  id: string;
  incremental: string;
  type: string;
  tags: string;
};

type KernelInfo = { version: string | null; built: string | null; author: string | null };

function sq(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

async function sh(device: DeviceTarget, cmd: string, timeout = 10000, root = false): Promise<string> {
  const full = root ? `su 0 sh -c ${sq(cmd)}` : cmd;
  return run("adb", ["-s", device.endpoint, "shell", full], timeout);
}

async function detectRoot(device: DeviceTarget): Promise<boolean> {
  const out = await sh(device, "id", 6000, true).catch(() => "");
  return /\buid=0\b/.test(out);
}

export function parseProps(raw: string): PropMap {
  const map: PropMap = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\[([^\]]+)\]: \[(.*)\]$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

export function splitFingerprint(fp: string): Fingerprint | null {
  const groups = fp.split(":");
  if (groups.length < 3) return null;
  const [brand = "", product = "", device = ""] = groups[0].split("/");
  const [release = "", id = "", incremental = ""] = groups[1].split("/");
  const [type = "", tags = ""] = groups[2].split("/");
  if (!brand || !release) return null;
  return { brand, product, device, release, id, incremental, type, tags };
}

function fmtDate(ms: number | null): string {
  if (!ms) return "?";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "?" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function ago(ms: number | null): string | null {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return null;
  const days = Math.floor(diff / 86400000);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days - years * 365) / 30);
    return `há ${years} ano${years > 1 ? "s" : ""}${months ? ` e ${months} ${months > 1 ? "meses" : "mês"}` : ""}`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `há ${months} ${months > 1 ? "meses" : "mês"}`;
  }
  if (days >= 1) return `há ${days} dia${days > 1 ? "s" : ""}`;
  return `há ${Math.max(1, Math.floor(diff / 3600000))} h`;
}

function fmtSysDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return value;
  const parsed = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}`);
  return Number.isNaN(parsed.getTime()) ? value : fmtDate(parsed.getTime());
}

function parseStatTime(value: string): number | null {
  const m = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d+ ([+-]\d{4})$/);
  if (!m) return null;
  const tz = `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const parsed = new Date(`${m[1]}T${m[2]}${tz}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

async function gservicesQuery(device: DeviceTarget, root: boolean, sql: string): Promise<string> {
  if (!root) return "";
  const rawUser = await sh(device, "cmd activity get-current-user", 6000).catch(() => "");
  const user = /^\d+$/.test(rawUser.trim()) ? rawUser.trim() : "0";
  const cmd = `for db in /data/user/${user}/*/*/gservices.db; do [ -f "$db" ] && sqlite3 "$db" ${sq(sql)}; done`;
  return sh(device, cmd, 12000, true).catch(() => "");
}

export async function readCert(device: DeviceTarget, root: boolean): Promise<CertState> {
  if (!root) return { status: null, expires: null, remaining: null, issued: null };
  const sql =
    'select name, value from main where name in ("uncertified_status", "uncertified_status_expiration_time_ms", "uncertified_status_expiration_remaining_time_ms");';
  const out = await gservicesQuery(device, root, sql);
  let status: string | null = null;
  let expires: number | null = null;
  let remaining: number | null = null;
  for (const line of out.split(/\r?\n/)) {
    const sep = line.indexOf("|");
    if (sep < 0) continue;
    const key = line.slice(0, sep);
    const value = line.slice(sep + 1).trim();
    if (key === "uncertified_status") status = value;
    else if (key === "uncertified_status_expiration_time_ms") expires = Number(value) || null;
    else if (key === "uncertified_status_expiration_remaining_time_ms") remaining = Number(value) || null;
  }
  const issued = expires !== null && remaining !== null ? expires - remaining : null;
  return { status, expires, remaining, issued };
}

export async function readCheckin(
  device: DeviceTarget,
  root: boolean,
): Promise<{ gsfId: string | null; time: number | null }> {
  if (!root) return { gsfId: null, time: null };
  const [xml, ids] = await Promise.all([
    sh(device, `cat ${CHECKIN_XML}`, 8000, true).catch(() => ""),
    gservicesQuery(device, root, 'select value from main where name = "android_id";'),
  ]);
  const fromDb = ids.split(/\r?\n/).map((l) => l.trim()).find((v) => /^\d+$/.test(v)) ?? null;
  const fromXml = xml.match(/<string name="android_id">([^<]+)</)?.[1]?.trim() ?? null;
  const time = Number(xml.match(/name="CheckinService_lastCheckinSuccessTime" value="(\d+)"/)?.[1] ?? 0) || null;
  return { gsfId: fromDb ?? fromXml, time };
}

async function pkgInfo(device: DeviceTarget, pkg: string): Promise<PkgInfo> {
  const out = await sh(
    device,
    `dumpsys package ${pkg} | grep -E 'versionName=|firstInstallTime=|lastUpdateTime=|Hidden system packages'`,
    15000,
  ).catch(() => "");
  const hiddenAt = out.search(/Hidden system packages:/i);
  const current = hiddenAt >= 0 ? out.slice(0, hiddenAt) : out;
  const hidden = hiddenAt >= 0 ? out.slice(hiddenAt) : "";
  const pick = (text: string) => ({
    version: text.match(/versionName=(\S+)/)?.[1] ?? null,
    installed: text.match(/firstInstallTime=([^\r\n]+)/)?.[1]?.trim() ?? null,
    updated: text.match(/lastUpdateTime=([^\r\n]+)/)?.[1]?.trim() ?? null,
  });
  const now = pick(current);
  const factory = pick(hidden).version;
  return { ...now, factory: factory && factory !== now.version ? factory : null };
}

async function googleAccounts(device: DeviceTarget, root: boolean): Promise<string[]> {
  const out = root
    ? await sh(device, "dumpsys account", 12000, true).catch(() => "")
    : await sh(device, "dumpsys account", 12000).catch(() => "");
  return [...out.matchAll(/Account \{name=([^,}]+), type=com\.google\}/g)].map((m) => m[1].trim());
}

async function networkCheck(device: DeviceTarget): Promise<string> {
  const out = await sh(device, "ping -c 1 -W 3 www.google.com", 7000).catch(() => "");
  const ms = out.match(/time=([\d.]+)/)?.[1];
  if (ms) return `www.google.com responde (${ms} ms)`;
  if (/1 received|1 packets received/i.test(out)) return "www.google.com responde";
  return "sem resposta de www.google.com";
}

async function clockCheck(device: DeviceTarget): Promise<string | null> {
  const out = await sh(device, "date '+%Y-%m-%d %H:%M:%S %Z'", 6000).catch(() => "");
  return out.trim() || null;
}

async function deviceIds(device: DeviceTarget): Promise<{ ssaid: string | null; serial: string | null }> {
  const [ssaid, serial] = await Promise.all([
    sh(device, "settings get secure android_id", 6000).catch(() => ""),
    sh(device, "getprop ro.serialno", 6000).catch(() => ""),
  ]);
  return { ssaid: ssaid.trim() || null, serial: serial.trim() || null };
}

async function statTimes(device: DeviceTarget, files: string[], root: boolean): Promise<Array<[string, number | null]>> {
  if (!root) return [];
  const out = await sh(device, `stat -c '%n|%y' ${files.join(" ")} 2>/dev/null`, 12000, true).catch(() => "");
  const rows: Array<[string, number | null]> = [];
  for (const line of out.split(/\r?\n/)) {
    const sep = line.indexOf("|");
    if (sep < 0) continue;
    rows.push([line.slice(0, sep), parseStatTime(line.slice(sep + 1))]);
  }
  return rows;
}

async function kernelInfo(device: DeviceTarget): Promise<KernelInfo> {
  const proc = await sh(device, "cat /proc/version", 6000).catch(() => "");
  return {
    version: proc.match(/^Linux version (\S+)/)?.[1] ?? null,
    author: proc.match(/\(([^)]+)\)/)?.[1] ?? null,
    built: proc.match(/PREEMPT\s+(.+)$/m)?.[1]?.trim() ?? null,
  };
}

function statusOf(raw: string | null): Status {
  if (raw === "0") return "certified";
  if (raw === "1") return "uncertified";
  return "unknown";
}

export function statusLabel(raw: string | null): string {
  if (raw === "0") return "CERTIFICADO (uncertified_status=0)";
  if (raw === "1") return "NÃO CERTIFICADO (uncertified_status=1)";
  return "não identificado";
}

export function identityFindings(
  props: PropMap,
  fp: string,
  fpParts: Fingerprint | null,
  partitions: Array<[string, string]>,
  buildType: string,
  tags: string,
): string[] {
  const findings: string[] = [];
  const manufacturer = props.get("ro.product.manufacturer") ?? "";
  const model = props.get("ro.product.model") ?? "";
  const device = props.get("ro.product.device") ?? "";
  const values = [...new Set(partitions.map(([, value]) => value).filter(Boolean))];

  if (fpParts && /^google$/i.test(fpParts.brand) && !/google/i.test(manufacturer)) {
    findings.push(
      `o fingerprint diz ser aparelho Google ("${fpParts.device}"), mas o hardware é ${[manufacturer, model].filter(Boolean).join(" ") || "desconhecido"}.`,
    );
  }
  if (fpParts && fpParts.device && device && fpParts.device !== device) {
    findings.push(`o fingerprint aponta device "${fpParts.device}" e ro.product.device é "${device}".`);
  }
  if (values.length && fp && values.length === 1 && values[0] !== fp) {
    findings.push(
      `só o fingerprint global foi trocado: system/vendor/product/odm/boot declaram "${values[0]}", que é a identidade real do firmware.`,
    );
  } else if (values.length > 1) {
    findings.push(`os fingerprints das partições não são iguais entre si: ${values.join(" | ")}`);
  }
  if (fpParts && fpParts.incremental === "" && fp.includes("/:/")) {
    findings.push(
      `o fingerprint global não tem o campo incremental ("${fpParts.release}/${fpParts.id}/:"), enquanto a build real declara ${props.get("ro.build.version.incremental") || "outro incremental"} — o fingerprint não corresponde à build.`,
    );
  }
  if (/test-keys/i.test(tags)) findings.push("a build é assinada com test-keys, não com a chave do fabricante.");
  if (/userdebug|eng/i.test(buildType)) findings.push(`a build é "${buildType}", não é user/release.`);
  if (/permissive/i.test(props.get("ro.boot.selinux") ?? "")) {
    findings.push("SELinux está em permissive (ro.boot.selinux), outro sinal de sistema modificado.");
  }
  if ((props.get("ro.debuggable") ?? "") === "1" || (props.get("ro.adb.secure") ?? "") === "0") {
    findings.push("ro.debuggable=1 e/ou ro.adb.secure=0: build de depuração, não de produção.");
  }
  return findings;
}

export async function playReport(device: DeviceTarget): Promise<string> {
  const root = await detectRoot(device);
  const [propsRaw, cert, checkin, store, gms, gsf, accounts, network, clock, ids, stats, kernel] = await Promise.all([
    sh(device, "getprop", 12000).catch(() => ""),
    readCert(device, root),
    readCheckin(device, root),
    pkgInfo(device, "com.android.vending"),
    pkgInfo(device, "com.google.android.gms"),
    pkgInfo(device, "com.google.android.gsf"),
    googleAccounts(device, root),
    networkCheck(device),
    clockCheck(device),
    deviceIds(device),
    statTimes(device, BUILD_PROP_FILES, root),
    kernelInfo(device),
  ]);

  const props = parseProps(propsRaw);
  const p = (name: string) => props.get(name) ?? "";

  const fp = p("ro.build.fingerprint");
  const fpParts = splitFingerprint(fp);
  const model = p("ro.product.model");
  const manufacturer = p("ro.product.manufacturer");
  const android = p("ro.build.version.release");
  const sdk = p("ro.build.version.sdk");
  const buildType = p("ro.build.type");
  const tags = p("ro.build.tags");
  const status = statusOf(cert.status);
  const partitions = PARTITION_FPS.map(([name, key]) => [name, p(key)] as [string, string]);
  const identity = identityFindings(props, fp, fpParts, partitions, buildType, tags);

  const buildUtc = Number(p("ro.build.date.utc")) * 1000 || null;
  const patch = p("ro.build.version.security_patch");
  const patchMs = patch ? Date.parse(`${patch}T00:00:00Z`) : null;
  const maintainer = [...props].find(([key]) => /maintainer/i.test(key))?.[1] ?? "";
  const buildAuthor = [p("ro.build.user"), p("ro.build.host")].filter(Boolean).join("@");
  const romProps = [...props].filter(([key, value]) => value && ROM_PROP_KEY.test(key)).slice(0, 8);

  const lines: string[] = [
    `${device.ip} — certificação do Play Store`,
    "",
    "── Aparelho ────────────────────────────",
    `  Modelo      : ${model || "?"}${manufacturer ? ` (${manufacturer})` : ""}`,
    `  Placa       : ${p("ro.board.platform") || "?"} / ${p("ro.hardware") || "?"} · ${p("ro.product.cpu.abi") || "?"}`,
    `  Android     : ${android || "?"} (SDK ${sdk || "?"})`,
    `  Build       : ${buildType || "?"} / ${tags || "?"}`,
    `  Fingerprint : ${fp || "?"}`,
    `  Relógio     : ${clock ?? "?"}`,
    "",
    "── ROM: origem, data e autor ───────────",
    `  Compilada   : ${p("ro.build.date") || "?"}${buildUtc ? ` (${ago(buildUtc) ?? "?"})` : ""}`,
    `  Kernel      : ${kernel.version ? `Linux ${kernel.version}` : "?"}${
      kernel.built ? `, ${kernel.built}` : ""
    }${kernel.author ? ` [${kernel.author}]` : ""}`,
    `  Autor       : ${maintainer ? `${maintainer} (maintainer)` : buildAuthor || kernel.author || "não declarado"}`,
    `  Versão      : ${p("ro.build.id") || "?"} / ${p("ro.build.version.incremental") || "?"}`,
    `  Descrição   : ${p("ro.build.description") || "?"}`,
    `  Patch       : ${patch || "?"}${patchMs ? ` (${ago(patchMs)})` : ""}`,
    `  Proteção    : ${[
      p("ro.boot.selinux") ? `SELinux ${p("ro.boot.selinux")}` : "",
      p("ro.debuggable") ? `debuggable=${p("ro.debuggable")}` : "",
      p("ro.adb.secure") ? `adb.secure=${p("ro.adb.secure")}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "?"}`,
    `  Primeiro uso: ${fmtSysDate(gms.installed) ?? "?"} (instalação do Play services)`,
  ];

  if (stats.length) {
    const files = stats
      .map(([file, ms]) => `${file.replace("/system/etc/prop.default", "prop.default")} ${ms ? fmtDate(ms) : "?"}`)
      .join(" · ");
    lines.push(`  Arquivos    : ${files}`);
  } else if (!root) {
    lines.push("  Arquivos    : (datas de build.prop precisam de root)");
  }

  lines.push(
    `  ROM         : ${
      romProps.length ? romProps.map(([key, value]) => `${key} = ${value}`).join(" · ") : "sem nome/versão/maintainer declarados"
    }`,
    "",
    "── Identidade do build ─────────────────",
    `  Fingerprint : ${fp || "?"}`,
  );
  if (fpParts) {
    lines.push(
      `    marca ${fpParts.brand} · produto ${fpParts.product} · device ${fpParts.device} · release ${fpParts.release}`,
      `    id ${fpParts.id || "(vazio)"} · incremental ${fpParts.incremental || "(vazio)"} · tipo ${fpParts.type} · tags ${fpParts.tags}`,
    );
  }
  const partitionValues = [...new Set(partitions.map(([, value]) => value).filter(Boolean))];
  if (partitionValues.length) {
    lines.push(
      `  Partições   : ${partitions.filter(([, value]) => value).map(([name]) => name).join("/")} → ${partitionValues.join(" | ")}`,
      `                ${partitionValues.length === 1 && partitionValues[0] === fp ? "igual ao fingerprint global" : "diferente do fingerprint global (só o prop global foi trocado)"}`,
    );
  }
  lines.push(
    `  Hardware    : ${[manufacturer, model].filter(Boolean).join(" ") || "?"}${p("ro.hardware") ? ` (${p("ro.hardware")})` : ""}`,
    "",
    "── Conta e identificação ───────────────",
    `  Conta Google: ${accounts.length ? accounts.join(", ") : "(não identificada)"}`,
    `  GSF ID      : ${checkin.gsfId ?? (root ? "(não lido)" : "(precisa de root)")}${
      checkin.gsfId ? " (android_id do gservices)" : ""
    }`,
    `  Android ID  : ${ids.ssaid ?? "?"} (Settings.Secure; não serve para o registro)`,
    `  Serial      : ${ids.serial ?? "?"}`,
    `  Check-in    : ${checkin.time ? fmtDate(checkin.time) : "?"}`,
    "",
    "── Certificação ────────────────────────",
    `  Status      : ${statusLabel(cert.status)}`,
  );

  if (cert.issued) {
    lines.push(`  Emitido em  : ${fmtDate(cert.issued)}${ago(cert.issued) ? ` (${ago(cert.issued)})` : ""}`);
  }
  if (cert.expires) {
    const days = Math.ceil((cert.expires - Date.now()) / 86400000);
    lines.push(`  Reavaliação : ${fmtDate(cert.expires)}${days > 0 ? ` (faltam ${days} dias)` : " (já venceu)"}`);
  } else if (!root) {
    lines.push("  Reavaliação : (leitura indisponível sem root)");
  }
  lines.push(
    `  Play Store         : ${store.version ?? "?"}${store.updated ? ` (atualizado ${fmtSysDate(store.updated)})` : ""}`,
    `  Play services      : ${gms.version ?? "?"}${gms.updated ? ` (atualizado ${fmtSysDate(gms.updated)})` : ""}`,
    `  Services Framework : ${gsf.version ?? "?"}`,
  );
  if (gms.factory) lines.push(`  GMS de fábrica     : ${gms.factory} (embutido na ROM)`);
  lines.push("", "── Rede ────────────────────────────────", `  google.com  : ${network}`, "");

  if (status === "certified") {
    lines.push("O servidor do Google considera este aparelho certificado.", "Nada a fazer.");
    return lines.join("\n");
  }

  lines.push("── Diagnóstico ─────────────────────────");
  if (status === "unknown") {
    lines.push("  • não consegui ler o veredito local (precisa de root e de sqlite3 no gservices).");
  }

  if (cert.issued) {
    const checkinTime = checkin.time;
    const checkinAfter = checkinTime !== null && checkinTime > cert.issued + 60000;
    lines.push(
      `  • veredito do servidor emitido em ${fmtDate(cert.issued)}${
        checkinAfter ? `; o check-in de ${fmtDate(checkinTime)} é posterior e não o alterou` : ""
      }.`,
      "    Se o registro do GSF ID foi feito depois dessa data, o Google ainda não",
      "    aplicou a mudança (o prazo relatado é de até 24 h).",
    );
  }

  if (identity.length) {
    lines.push("", "  Identidade (o que o Google pode estar recusando):");
    for (const item of identity) lines.push(`  • ${item}`);
  } else {
    lines.push("  • o build não mostra desvios evidentes de identidade.");
  }

  lines.push(
    "",
    "  • a idade do Android não entra no veredito: a Play Store e o Play services",
    "    continuam atualizando neste firmware. O que pesa é GSF ID + identidade",
    "    do build (fingerprint, assinatura e flags acima).",
    "",
    "  Conclusão: os desvios de identidade listados são compatíveis com recusa do",
    "  build, independente de o GSF ID estar registrado. O Google não informa o",
    "  motivo; esta leitura é inferida do estado local do aparelho.",
    "",
    "── Como resolver ───────────────────────",
    "  1. Registre o GSF ID acima em https://www.google.com/android/uncertified",
    "     com a mesma conta Google da box. O ID muda se a box for resetada.",
  );

  if (cert.issued) {
    lines.push(
      `  2. Se já registrou: o veredito em vigor é de ${fmtDate(cert.issued)}. Rode`,
      `     play ${device.ip} depois e compare a linha "Emitido em".`,
      '  3. Se "Emitido em" avançar para depois do registro e o status seguir 1,',
      "     o servidor recusou a identidade deste build (veja a seção Identidade).",
      "     Nesse caso só firmware com identidade própria resolve — nenhum",
      "     comando local muda o veredito.",
    );
  } else {
    lines.push(
      `  2. Rode play ${device.ip} depois de registrar e confira o status.`,
      "  3. Se o status seguir 1, compare o build com a seção Identidade.",
    );
  }
  lines.push(
    "  4. Não limpe os dados do Google Play services: troca o GSF ID e invalida",
    "     o registro. Os dados da Play Store podem ser limpos sem afetar a conta.",
  );
  return lines.join("\n");
}

export async function recheckCertification(device: DeviceTarget, clearStore: boolean): Promise<string> {
  const root = await detectRoot(device);
  const before = await readCert(device, root);
  const beforeCheckin = await readCheckin(device, root);

  const lines: string[] = [
    `${device.ip} — recheck da certificação do Play Store`,
    "",
    `  GSF ID      : ${beforeCheckin.gsfId ?? (root ? "(não lido)" : "(precisa de root)")}`,
    `  Status antes: ${statusLabel(before.status)}`,
  ];
  if (before.issued) lines.push(`  Veredito    : ${fmtDate(before.issued)}${ago(before.issued) ? ` (${ago(before.issued)})` : ""}`);
  if (beforeCheckin.time) lines.push(`  Check-in    : ${fmtDate(beforeCheckin.time)}`);
  lines.push("", "Passos:");

  await sh(device, "am force-stop com.android.vending", 8000).catch(() => "");
  lines.push("  • Play Store parado");

  if (clearStore) {
    const out = await sh(device, "pm clear com.android.vending", 25000).catch((e: Error) => e.message);
    lines.push(`  • dados do Play Store apagados (${out.trim() || "sem resposta"})`);
  }

  const bcast = await sh(
    device,
    "am broadcast -a android.server.checkin.CHECKIN_NOW -f 0x01000000",
    12000,
    root,
  ).catch((e: Error) => e.message);
  const sent = /Broadcast completed|result=/i.test(bcast);
  if (sent) {
    lines.push(root ? "  • check-in forçado: enviado" : "  • check-in enviado (sem root, pode ser bloqueado pelo sistema)");
  } else {
    lines.push(`  • check-in NÃO enviado: ${bcast.trim() || "sem resposta"}`);
    if (!root) lines.push("    (com root o broadcast é aceito; sem root o Android bloqueia)");
  }

  const launch = await sh(
    device,
    "monkey -p com.android.vending -c android.intent.category.LAUNCHER 1",
    15000,
  ).catch((e: Error) => e.message);
  let opened = /Events injected/i.test(launch);
  if (!opened) {
    const alt = await sh(
      device,
      "am start -n com.android.vending/com.google.android.finsky.activities.MainActivity",
      15000,
    ).catch((e: Error) => e.message);
    opened = /Starting:|Warning: Activity not started/i.test(alt);
    if (!opened && alt.trim()) lines.push(`  • aviso ao abrir a Play Store: ${alt.trim().split(/\r?\n/)[0]}`);
  }
  lines.push(opened ? "  • Play Store aberta na TV" : "  • não consegui abrir a Play Store");

  lines.push("", "Aguardando o servidor responder (até 30 s)…");
  let after = before;
  for (let i = 0; i < 6; i++) {
    await delay(5000);
    after = await readCert(device, root);
    if (after.status !== before.status) break;
  }

  const afterCheckin = await readCheckin(device, root);
  lines.push("", `  Status depois: ${statusLabel(after.status)}`);
  if (after.expires) lines.push(`  Reavaliação  : ${fmtDate(after.expires)}`);
  const reissued = after.issued !== null && before.issued !== null && after.issued > before.issued + 1000;
  if (after.issued) {
    lines.push(
      `  Veredito     : ${fmtDate(after.issued)}${reissued ? " (reemitido agora pelo servidor)" : " (sem reemissão)"}`,
    );
  }
  if (afterCheckin.time && afterCheckin.time !== beforeCheckin.time) {
    lines.push(`  Check-in     : confirmado em ${fmtDate(afterCheckin.time)}`);
  }

  lines.push("");
  if (after.status === "0") {
    lines.push(
      "Certificação restabelecida. Se a Play Store ainda mostrar o aviso,",
      "feche e abra o app novamente.",
    );
  } else if (after.status === "1") {
    if (reissued) {
      lines.push(
        "O servidor reavaliou agora e manteve a recusa.",
        "Rode o diagnóstico completo para ver a identidade do build:",
        `  play ${device.ip}`,
      );
    } else {
      lines.push(
        "O servidor não emitiu veredito novo: ele continua com o mesmo registro",
        "de recusa e não é alterado por check-in nem por limpar a Play Store",
        "(o veredito fica no gservices do Play services).",
        "Se o registro do GSF ID foi feito depois da data acima, aguarde até 24 h",
        "e reinicie a box uma vez. Depois rode:",
        `  play ${device.ip}`,
      );
    }
  } else {
    lines.push(
      "Não consegui ler o status local. Abra a Play Store na TV e verifique",
      "se o aviso de certificação desapareceu; rode play novamente depois.",
    );
  }
  return lines.join("\n");
}
