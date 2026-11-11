import { run } from "./client.js";

type UsbDevice = {
  status: string;
  cls: string;
  name: string;
  instanceId: string;
  vid: string;
  pid: string;
  known: string | null;
};

const KNOWN_VID: Record<string, string> = {
  "18d1": "Google (Android/ADB)",
  "2d01": "Allwinner (PhoenixSuit)",
  "1f3a": "Allwinner",
  "2207": "Rockchip",
  "04e8": "Samsung",
  "2717": "Xiaomi",
  "22b8": "Motorola",
  "12d1": "Huawei",
  "05c6": "Qualcomm",
  "1004": "LG",
  "0bb4": "HTC",
  "046d": "Logitech",
  "045e": "Microsoft",
  "0b05": "ASUS",
  "05e3": "Genesys Logic",
  "04d9": "Holtek",
  "1532": "Razer",
  "1b1c": "Corsair",
  "0951": "Kingston",
  "0781": "SanDisk",
};

let lastSnapshot: string[] | null = null;

function keyOf(d: UsbDevice): string {
  return `${d.vid}:${d.pid}:${d.name}`;
}

async function listWindowsUsb(): Promise<UsbDevice[]> {
  const script =
    "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue " +
    "| Where-Object { $_.InstanceId -like 'USB\\VID_*' } " +
    "| ForEach-Object { $_.Status + '~' + $_.Class + '~' + $_.FriendlyName + '~' + $_.InstanceId }";
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 15000);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [status = "", cls = "", name = "", instanceId = ""] = line.split("~");
      const m = instanceId.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);
      const vid = m ? m[1].toUpperCase() : "";
      const pid = m ? m[2].toUpperCase() : "";
      return {
        status,
        cls,
        name: name.trim() || "(sem nome)",
        instanceId,
        vid,
        pid,
        known: vid ? (KNOWN_VID[vid.toLowerCase()] ?? null) : null,
      };
    });
}

function adbList(out: string): string[] {
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !/^\*/.test(l));
}

function isAdbInterface(d: UsbDevice): boolean {
  return d.cls === "AndroidUsbDeviceClass" || /adb|android/i.test(d.name);
}

function describe(d: UsbDevice): string {
  const ids = d.vid ? `${d.vid}:${d.pid}` : "????:????";
  const vendor = d.known ?? (d.vid ? "fabricante desconhecido" : "");
  const state = d.status && d.status !== "OK" ? `  (${d.status})` : "";
  return `  • ${ids}  ${vendor}  ${d.name}${d.cls ? `  [${d.cls}]` : ""}${state}`;
}

export async function inspectUsb(): Promise<string> {
  const lines: string[] = [];

  let adbOut = "";
  let adbError: string | null = null;
  try {
    adbOut = await run("adb", ["devices", "-l"], 8000);
  } catch (e) {
    adbError = (e as Error).message;
  }
  const adbLines = adbError ? [] : adbList(adbOut);

  lines.push("── ADB (adb devices -l) ──────────────");
  if (adbError) lines.push(`  ${adbError}`);
  else if (adbLines.length === 0) lines.push("  nenhum aparelho");
  else for (const l of adbLines) lines.push(`  ${l}`);

  let usb: UsbDevice[] = [];
  let usbError: string | null = null;
  if (process.platform === "win32") {
    try {
      usb = await listWindowsUsb();
    } catch (e) {
      usbError = (e as Error).message;
    }
  } else {
    usbError = "Listagem de USB disponível apenas no Windows.";
  }

  lines.push("", "── USB visto pelo sistema ────────────");
  if (usbError) lines.push(`  ${usbError}`);
  else if (usb.length === 0) lines.push("  nenhum dispositivo USB com VID");
  else {
    const unique = new Map<string, UsbDevice>();
    for (const d of usb) if (!unique.has(keyOf(d))) unique.set(keyOf(d), d);
    lines.push(`  ${unique.size} dispositivo(s) único(s) em ${usb.length} interface(s)`);
    const ordered = [...unique.values()].sort(
      (a, b) => a.vid.localeCompare(b.vid) || a.name.localeCompare(b.name),
    );
    for (const d of ordered) lines.push(describe(d));
  }

  const firstRun = lastSnapshot === null;
  const snapshot = [...new Set(usb.map(keyOf))];
  let freshUsb: UsbDevice[] = [];
  if (!firstRun) {
    const before = new Set(lastSnapshot!);
    freshUsb = usb.filter((d) => !before.has(keyOf(d)));
    if (freshUsb.length > 0) {
      lines.push("", "── Novos desde a última consulta ─────");
      for (const d of freshUsb) lines.push(describe(d));
    } else {
      lines.push("", "Nenhum dispositivo USB novo desde a última consulta.");
    }
  } else {
    lines.push("", "Primeira consulta registrada. Rode `usb` de novo depois de plugar o cabo para ver o que apareceu.");
  }
  lastSnapshot = snapshot;

  lines.push("", "── Leitura ───────────────────────────");
  const adbOk = adbLines.some((l) => /\sdevice\s/.test(` ${l} `));
  const hasAdbInterface = usb.some(isAdbInterface);
  const hasMtp = usb.some((d) => d.cls === "WPD");
  const hasRndis = usb.some((d) => d.cls === "Net");
  const felMode = usb.some((d) => d.vid === "2D01" || (d.vid === "1F3A" && d.pid === "EFE8"));
  const allwinnerVendor = usb.some((d) => d.vid === "1F3A");

  if (adbOk) {
    const serial = adbLines.find((l) => /\sdevice\s/.test(` ${l} `))?.split(/\s+/)[0] ?? "";
    lines.push(
      "  ADB por USB funcionando.",
      `  Rode \`tcpip ${serial}\` para ligar o ADB de rede e liberar o Wi-Fi.`,
    );
  } else if (hasAdbInterface) {
    lines.push(
      "  O PC viu a interface ADB, mas o adb não listou o aparelho como 'device'.",
      "  Autorize 'Permitir depuração USB' na tela da box e rode `usb` de novo.",
      "  Se seguir em 'unauthorized', revogue as autorizações USB nas opções do desenvolvedor.",
    );
  } else if (felMode) {
    lines.push(
      "  A box apareceu no modo FEL/boot ROM da Allwinner (PhoenixSuit).",
      "  Desligue da tomada e ligue normalmente para o Android subir com ADB.",
    );
  } else if (hasMtp) {
    lines.push(
      "  O PC viu a box como armazenamento/MTP.",
      "  O cabo é de dados, mas a depuração USB não está ativa:",
      "  ligue 'Depuração USB' e 'USB device mode' nas opções do desenvolvedor.",
    );
  } else if (hasRndis) {
    lines.push("  A box apareceu como rede USB (RNDIS). O cabo é de dados; falta habilitar a depuração USB.");
  } else if (allwinnerVendor) {
    lines.push(
      "  O Windows viu o USB da Allwinner, mas sem a interface ADB.",
      "  A box está ligada e falando USB em modo de fornecedor; isso não é modo gravação.",
      "  Na TV: Opções do desenvolvedor > ligue 'Depuração USB' e reconecte o cabo.",
      "  Sem esse ajuste o adb não enxerga a box e o ADB de rede continua desligado após o reboot.",
    );
  } else if ((firstRun ? usb : freshUsb).some((d) => d.status !== "OK")) {
    lines.push(
      "  O Windows viu um USB com problema de driver (status diferente de OK).",
      "  Abra o Gerenciador de Dispositivos, veja o item com '!' e instale/atualize o driver.",
      "  Para ADB costuma bastar o Google USB Driver; sem driver o adb não lista o aparelho.",
    );
  } else if (firstRun) {
    lines.push(
      "  Estado inicial salvo.",
      "  Agora plugue o cabo na box e no PC e rode `usb` de novo:",
      "  o que aparecer vai ser listado em 'Novos desde a última consulta'.",
    );
  } else if (usb.length > 0) {
    lines.push(
      "  Nenhum dispositivo novo apareceu no USB.",
      "  Causas comuns: cabo só de carga, cabo A-A (macho-macho) entre duas portas HOST,",
      "  ou porta da box apenas de energia. USB não negocia host com host:",
      "  um lado precisa ser porta de dispositivo (OTG/micro-USB).",
      "  Teste o cabo em um celular: se ele não aparecer, o cabo é só de carga.",
    );
  } else {
    lines.push("  Não consegui listar o USB do sistema.");
  }

  return lines.join("\n");
}
