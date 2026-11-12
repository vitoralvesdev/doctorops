import { run } from "../adb/client.js";
import type { DeviceTarget } from "../adb/ops.js";
import { delay } from "../core/time.js";

const UPDATE_PKG = "com.softwinner.update";
const OTA_SERVICE = `${UPDATE_PKG}/.OtaService`;

type OtaInfo = {
  props: Map<string, string>;
  root: boolean;
  updater: boolean;
};

function sq(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

async function sh(device: DeviceTarget, cmd: string, timeout = 12000, root = false): Promise<string> {
  const full = root ? `su 0 sh -c ${sq(cmd)}` : cmd;
  return run("adb", ["-s", device.endpoint, "shell", full], timeout);
}

function prop(info: OtaInfo, key: string): string {
  return info.props.get(key)?.trim() ?? "";
}

async function parseProps(raw: string): Promise<Map<string, string>> {
  const props = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/);
    if (match) props.set(match[1], match[2]);
  }
  return props;
}

async function inspectOta(device: DeviceTarget): Promise<OtaInfo> {
  const [rootRaw, propsRaw, updaterRaw] = await Promise.all([
    sh(device, "id", 6000, true).catch(() => ""),
    sh(device, "getprop", 15000).catch(() => ""),
    sh(device, `pm path ${UPDATE_PKG}`, 8000).catch(() => ""),
  ]);
  return {
    props: await parseProps(propsRaw),
    root: /\buid=0\b/.test(rootRaw),
    updater: Boolean(updaterRaw.trim()),
  };
}

async function netStatus(device: DeviceTarget, host: string): Promise<string> {
  const out = await sh(device, `ping -c 1 -W 3 ${host} 2>&1; echo RC=$?`, 10000).catch(() => "");
  const rc = out.match(/RC=(\d+)/)?.[1];
  if (rc === "0") return "resolve e responde ao ping";
  if (rc === "2") return "domínio não existe (DNS falhou)";
  return "resolve, mas não responde ao ping";
}

async function tcpStatus(device: DeviceTarget, host: string, port = 80): Promise<string> {
  const out = await sh(device, `printf '' | nc -w 5 ${host} ${port} 2>&1; echo RC=$?`, 12000).catch(() => "");
  if (/RC=0/.test(out)) return `porta ${port} aberta`;
  if (/refused/i.test(out)) return `porta ${port} recusada`;
  if (/timeout|timed/i.test(out)) return `porta ${port} sem resposta (timeout)`;
  return `porta ${port} inacessível`;
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

async function readUi(device: DeviceTarget): Promise<string> {
  return sh(device, "uiautomator dump /sdcard/.ota_ui.xml >/dev/null 2>&1; cat /sdcard/.ota_ui.xml", 20000).catch(() => "");
}

async function adbOnline(device: DeviceTarget): Promise<boolean> {
  const out = await run("adb", ["-s", device.endpoint, "get-state"], 8000).catch(() => "");
  return out.trim() === "device";
}

async function adbGone(device: DeviceTarget): Promise<boolean> {
  if (await adbOnline(device)) return false;
  await delay(3000);
  return !(await adbOnline(device));
}

const INSTALL_BUTTONS = ["upgrade", "install", "update", "confirm", "download", "reboot"];

export async function forceOtaUpdate(device: DeviceTarget, confirmed: boolean): Promise<{ ok: boolean; output: string }> {
  const info = await inspectOta(device);

  const lines: string[] = [
    `${device.ip} — atualização online (OTA do fabricante)`,
    "",
    "── Aparelho ────────────────────────────",
    `  Modelo      : ${prop(info, "ro.product.model") || "?"} (${prop(info, "ro.product.device") || "?"})`,
    `  Build atual : ${prop(info, "ro.fota.version") || prop(info, "ro.build.display.id") || "?"}`,
    `  OTA URL     : ${prop(info, "ro.product.otaupdateurl") || "não declarada"}`,
    `  Root        : ${info.root ? "sim" : "não"}`,
    `  Updater     : ${info.updater ? "com.softwinner.update presente" : "com.softwinner.update NÃO encontrado"}`,
    "",
  ];

  if (!info.updater) {
    lines.push(
      "── Resultado ───────────────────────────",
      "  NENHUMA ATUALIZAÇÃO FOI APLICADA.",
      "  O app de atualização do fabricante não está instalado nesta box;",
      "  não há canal oficial de OTA para forçar.",
    );
    return { ok: false, output: lines.join("\n") };
  }

  const [otaHostLine, apiStatus, wsStatus] = await Promise.all([
    (async () => {
      const url = prop(info, "ro.product.otaupdateurl");
      const host = url.replace(/^https?:\/\//, "").split(/[/:]/)[0];
      if (!host) return "URL de OTA não declarada";
      return `${await netStatus(device, host)} · ${await tcpStatus(device, host)}`;
    })(),
    netStatus(device, "api.bigbigcloud.cn"),
    netStatus(device, "ws.bigbigcloud.cn"),
  ]);

  lines.push(
    "── Canal do fabricante ─────────────────",
    `  ota.szhxws.com      : ${otaHostLine}`,
    `  api.bigbigcloud.cn  : ${apiStatus}`,
    `  ws.bigbigcloud.cn   : ${wsStatus}`,
    "",
    "── Verificação forçada ─────────────────",
  );

  if (!info.root) {
    lines.push(
      "  Sem root não dá para forçar a checagem: o serviço OtaService só pode",
      "  ser iniciado pelo próprio app (uid 1000). O fabricante controla quando",
      "  a box checa atualização.",
      "",
      "  NENHUMA ATUALIZAÇÃO FOI APLICADA.",
    );
    return { ok: false, output: lines.join("\n") };
  }

  await sh(device, "logcat -c", 8000, true).catch(() => "");
  const started = await sh(device, `am startservice -n ${OTA_SERVICE}`, 10000, true).catch((e: Error) => e.message);
  if (/error|exception/i.test(started)) {
    lines.push(`  • não consegui iniciar o OtaService: ${started.trim().split(/\r?\n/)[0]}`);
    lines.push("", "  NENHUMA ATUALIZAÇÃO FOI APLICADA.");
    return { ok: false, output: lines.join("\n") };
  }
  lines.push("  • OtaService iniciado via root; aguardando a checagem no servidor…");
  await delay(18000);

  const log = await sh(
    device,
    "logcat -d -t 500 | grep -iE 'bbcdevice|otaservice|x_log|httptask|cleartext|websocket|subscribe|register|sync device|could not'",
    25000,
  ).catch(() => "");

  const findings: string[] = [];
  if (/Cleartext HTTP traffic/i.test(log)) {
    findings.push("o app de atualização é bloqueado pelo Android 10: ele usa HTTP sem criptografia e a política de rede do sistema recusa (Cleartext not permitted)");
  }
  if (/Could not connect|unknown host|Name or service not known|ENOTFOUND|failed to connect/i.test(log)) {
    findings.push("o app não conseguiu falar com o servidor (falha de DNS/conexão nos logs)");
  }
  if (/register device|onconnect|subscribe/i.test(log)) {
    findings.push("o app chegou a registrar/conectar o dispositivo no servidor");
  }
  if (!findings.length) {
    findings.push("o app não registrou tentativa de checagem nos logs (serviço pode estar inerte nesta build)");
  }
  for (const f of findings) lines.push(`  • ${f}`);

  const xml = await readUi(device);
  const buttons = uiButtons(xml).filter((b) => /com\.softwinner\.update/.test(xml));
  const offer = INSTALL_BUTTONS.map((label) => buttons.find((b) => b.text.toLowerCase() === label)).find(Boolean);

  lines.push("", "── Resultado ───────────────────────────");
  if (!offer) {
    lines.push(
      "  NENHUMA ATUALIZAÇÃO DISPONÍVEL.",
      "  A checagem forçada terminou sem oferta de atualização na tela.",
      "  Se o canal estiver morto (domínio fora do ar ou HTTP bloqueado),",
      "  não existe OTA oficial para forçar — a única rota é ROM local via",
      "  update firmware (pacote OTA .zip assinado).",
    );
    await sh(device, `am stopservice -n ${OTA_SERVICE}`, 8000, true).catch(() => "");
    await sh(device, "rm -f /sdcard/.ota_ui.xml", 8000).catch(() => "");
    return { ok: false, output: lines.join("\n") };
  }

  lines.push(`  O fabricante oferece uma atualização (botão "${offer.text}" na tela).`);
  if (!confirmed) {
    lines.push(
      "",
      "  Nada foi instalado. Para aceitar e instalar:",
      `    update ota ${device.ip} confirmar`,
    );
    await sh(device, "rm -f /sdcard/.ota_ui.xml", 8000).catch(() => "");
    return { ok: true, output: lines.join("\n") };
  }

  lines.push("  • aceitando a atualização…");
  for (let step = 0; step < 14; step++) {
    const current = uiButtons(await readUi(device));
    const target = INSTALL_BUTTONS.map((label) => current.find((b) => b.text.toLowerCase() === label)).find(Boolean);
    if (target) {
      lines.push(`  • tocando em "${target.text}" (${target.x},${target.y})`);
      await sh(device, `input tap ${target.x} ${target.y}`, 8000).catch(() => "");
    }
    await delay(4000);
    if (await adbGone(device)) {
      lines.push(
        "",
        "  INSTALAÇÃO INICIADA: a box saiu do ADB e está aplicando a atualização.",
      );
      await sh(device, "rm -f /sdcard/.ota_ui.xml", 8000).catch(() => "");
      return { ok: true, output: lines.join("\n") };
    }
  }
  lines.push("", "  A instalação não começou; nada foi aplicado.");
  await sh(device, `am stopservice -n ${OTA_SERVICE}`, 8000, true).catch(() => "");
  await sh(device, "rm -f /sdcard/.ota_ui.xml", 8000).catch(() => "");
  return { ok: false, output: lines.join("\n") };
}
