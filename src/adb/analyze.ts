import type { DeviceTarget } from "./ops.js";
import { run } from "./client.js";

type Verdict = "remove" | "review" | "keep";

type Rule = { pkg: string; verdict: Verdict; why: string };

const KEEP: Rule[] = [
  { pkg: "android", verdict: "keep", why: "framework do Android" },
  { pkg: "com.android.systemui", verdict: "keep", why: "interface do sistema" },
  { pkg: "com.android.tv.settings", verdict: "keep", why: "app de configurações" },
  { pkg: "com.android.settings", verdict: "keep", why: "app de configurações" },
  { pkg: "com.android.permissioncontroller", verdict: "keep", why: "permissões dos apps" },
  { pkg: "com.android.webview", verdict: "keep", why: "motor WebView usado por apps" },
  { pkg: "com.google.android.webview", verdict: "keep", why: "motor WebView usado por apps" },
  { pkg: "com.android.networkstack.inprocess", verdict: "keep", why: "rede do sistema" },
  { pkg: "com.android.networkstack.permissionconfig", verdict: "keep", why: "rede do sistema" },
  { pkg: "com.android.providers.settings", verdict: "keep", why: "configurações do sistema" },
  { pkg: "com.android.providers.media", verdict: "keep", why: "armazenamento de mídia" },
  { pkg: "com.android.providers.downloads", verdict: "keep", why: "downloads do sistema" },
  { pkg: "com.android.providers.downloads.ui", verdict: "keep", why: "tela de downloads" },
  { pkg: "com.android.providers.tv", verdict: "keep", why: "dados de TV do launcher" },
  { pkg: "com.android.externalstorage", verdict: "keep", why: "armazenamento externo" },
  { pkg: "com.android.documentsui", verdict: "keep", why: "seletor de arquivos do sistema" },
  { pkg: "com.android.packageinstaller", verdict: "keep", why: "instalador de apps" },
  { pkg: "com.google.android.packageinstaller", verdict: "keep", why: "instalador de apps" },
  { pkg: "com.android.shell", verdict: "keep", why: "ADB e este programa" },
  { pkg: "com.android.certinstaller", verdict: "keep", why: "instalação de certificados" },
  { pkg: "com.android.inputmethod.latin", verdict: "keep", why: "teclado do sistema" },
  { pkg: "com.android.keychain", verdict: "keep", why: "chaves e VPN" },
  { pkg: "com.android.modulemetadata", verdict: "keep", why: "módulos do sistema" },
  { pkg: "com.android.inputdevices", verdict: "keep", why: "entrada e controles" },
  { pkg: "com.android.captiveportallogin", verdict: "keep", why: "login de Wi-Fi público" },
  { pkg: "com.android.location.fused", verdict: "keep", why: "localização do sistema" },
  { pkg: "com.android.storagemanager", verdict: "keep", why: "tela de armazenamento" },
  { pkg: "com.android.se", verdict: "keep", why: "elemento seguro (DRM/keystore)" },
  { pkg: "com.actions.hidaudio", verdict: "keep", why: "áudio do fabricante" },
  { pkg: "com.softwinner.provision", verdict: "keep", why: "provisionamento da box" },
  { pkg: "com.softwinner.settingsassist", verdict: "keep", why: "assistente de configurações" },
  { pkg: "com.softwinner.update", verdict: "keep", why: "atualização do fabricante" },
  { pkg: "com.softwinner.TvdFileManager", verdict: "keep", why: "gerenciador de arquivos" },
  { pkg: "com.hx.mboxlauncher", verdict: "keep", why: "launcher da box" },
  { pkg: "com.hx.guardservice", verdict: "keep", why: "watchdog do fabricante" },
  { pkg: "com.hx.update", verdict: "keep", why: "atualização da box" },
  { pkg: "com.hx.pluginmanager", verdict: "keep", why: "plugins do launcher" },
  { pkg: "com.allwinnertech.packageoverride", verdict: "keep", why: "regras de pacotes do fabricante" },
  { pkg: "android.auto_generated_rro_product__", verdict: "keep", why: "overlay de recursos do sistema" },
  { pkg: "android.auto_generated_rro_vendor__", verdict: "keep", why: "overlay de recursos do fabricante" },
  { pkg: "com.android.settings.intelligence", verdict: "keep", why: "busca dentro das Configurações" },
  { pkg: "com.android.statementservice", verdict: "keep", why: "verificação de links de apps" },
];

const REMOVE: Rule[] = [
  { pkg: "com.hx.autotesttool", verdict: "remove", why: "ferramenta de teste de fábrica" },
  { pkg: "com.hx.videotest", verdict: "remove", why: "teste de vídeo de fábrica" },
  { pkg: "com.hxdevicetest", verdict: "remove", why: "teste de hardware de fábrica" },
  { pkg: "com.softwinner.agingdragonbox", verdict: "remove", why: "teste de envelhecimento de fábrica" },
  { pkg: "com.softwinner.dragonbox", verdict: "remove", why: "teste de produção de fábrica" },
  { pkg: "com.dd.bugreport", verdict: "remove", why: "coletor de relatório de bugs de terceiros" },
  { pkg: "pt.pedro.textfileviewer", verdict: "remove", why: "visualizador de texto de terceiros" },
  { pkg: "com.android.egg", verdict: "remove", why: "easter egg do Android" },
  { pkg: "com.android.dreams.basic", verdict: "remove", why: "protetor de tela" },
  { pkg: "com.android.dreams.web", verdict: "remove", why: "protetor de tela" },
  { pkg: "com.android.printspooler", verdict: "remove", why: "serviço de impressão" },
  { pkg: "com.android.printservice.recommendation", verdict: "remove", why: "recomendação de impressora" },
  { pkg: "com.android.bips", verdict: "remove", why: "impressão integrada" },
  { pkg: "com.android.wallpaperbackup", verdict: "remove", why: "backup de papel de parede" },
  { pkg: "com.android.wallpapercropper", verdict: "remove", why: "corte de papel de parede" },
  { pkg: "com.android.camera2", verdict: "remove", why: "câmera (a box não tem)" },
  { pkg: "com.android.music", verdict: "remove", why: "player de música AOSP" },
  { pkg: "com.android.musicfx", verdict: "remove", why: "efeitos do player AOSP" },
  { pkg: "com.android.gallery3d", verdict: "remove", why: "galeria AOSP" },
  { pkg: "com.android.providers.partnerbookmarks", verdict: "remove", why: "favoritos de parceiro do navegador" },
  { pkg: "com.android.cts.ctsshim", verdict: "remove", why: "shim de testes do CTS" },
  { pkg: "com.android.cts.priv.ctsshim", verdict: "remove", why: "shim de testes do CTS" },
  { pkg: "com.android.backupconfirm", verdict: "remove", why: "confirmação de backup" },
  { pkg: "com.android.sharedstoragebackup", verdict: "remove", why: "backup de armazenamento compartilhado" },
  { pkg: "com.android.bluetoothmidiservice", verdict: "remove", why: "MIDI por Bluetooth (não usado)" },
  { pkg: "com.android.simappdialog", verdict: "remove", why: "aviso de SIM (box sem modem)" },
  { pkg: "com.android.dynsystem", verdict: "remove", why: "atualização dinâmica de sistema (GSI)" },
  { pkg: "com.android.managedprovisioning", verdict: "remove", why: "provisionamento corporativo" },
  { pkg: "com.google.android.apps.restore", verdict: "remove", why: "restauração de backup do Google" },
  { pkg: "com.google.android.onetimeinitializer", verdict: "remove", why: "configuração inicial do Google" },
  { pkg: "com.google.android.configupdater", verdict: "remove", why: "atualização de config do Google" },
  { pkg: "com.google.android.partnersetup", verdict: "remove", why: "configuração de parceiro do Google" },
  { pkg: "com.google.android.syncadapters.contacts", verdict: "remove", why: "sincronização de contatos Google" },
  { pkg: "com.google.android.backuptransport", verdict: "remove", why: "transporte de backup do Google" },
];

const REVIEW: Rule[] = [
  { pkg: "com.android.chrome", verdict: "review", why: "navegador do sistema" },
  { pkg: "com.android.vending", verdict: "review", why: "Play Store — mantenha se instala apps por ele" },
  { pkg: "com.google.android.gms", verdict: "review", why: "serviços do Play — apps de terceiros podem depender" },
  { pkg: "com.google.android.gsf", verdict: "review", why: "base dos serviços Google" },
  { pkg: "com.google.android.ext.services", verdict: "review", why: "suporte ao GMS" },
  { pkg: "com.google.android.ext.shared", verdict: "review", why: "suporte ao GMS" },
  { pkg: "com.google.android.googlequicksearchbox", verdict: "review", why: "busca/assistente Google — grande consumidor de RAM" },
  { pkg: "com.google.android.tts", verdict: "review", why: "voz sintetizada/acessibilidade" },
  { pkg: "com.android.phone", verdict: "review", why: "telefonia (box não usa, mas o stack pode consultar)" },
  { pkg: "com.android.providers.telephony", verdict: "review", why: "telefonia/SMS" },
  { pkg: "com.android.server.telecom", verdict: "review", why: "telefonia" },
  { pkg: "com.android.mms.service", verdict: "review", why: "SMS" },
  { pkg: "com.android.providers.blockednumber", verdict: "review", why: "bloqueio de chamadas" },
  { pkg: "com.android.hotspot2", verdict: "review", why: "Wi-Fi Passpoint" },
  { pkg: "com.android.bluetooth", verdict: "review", why: "controle remoto Bluetooth pode depender" },
  { pkg: "com.android.nfc", verdict: "review", why: "NFC — remova só se a box não tiver leitor" },
  { pkg: "com.android.mtp", verdict: "review", why: "transferência de arquivos por USB" },
  { pkg: "com.android.providers.contacts", verdict: "review", why: "contatos do sistema" },
  { pkg: "com.android.providers.calendar", verdict: "review", why: "calendário do sistema" },
  { pkg: "com.android.providers.userdictionary", verdict: "review", why: "sugestões do teclado" },
  { pkg: "com.android.bookmarkprovider", verdict: "review", why: "favoritos do navegador AOSP" },
  { pkg: "com.android.htmlviewer", verdict: "review", why: "visualizador HTML usado por alguns apps" },
  { pkg: "com.android.proxyhandler", verdict: "review", why: "suporte a proxy" },
  { pkg: "com.android.pacprocessor", verdict: "review", why: "processador de proxy PAC" },
  { pkg: "com.android.localtransport", verdict: "review", why: "transporte de backup local" },
  { pkg: "com.android.vpndialogs", verdict: "review", why: "suporte a VPN" },
  { pkg: "com.android.companiondevicemanager", verdict: "review", why: "pareamento de acessórios" },
  { pkg: "com.hx.apkbridge", verdict: "review", why: "ponte de instalação de APK do fabricante" },
  { pkg: "com.hx.appcleaner", verdict: "review", why: "limpador do fabricante — útil para liberar memória" },
  { pkg: "com.hx.rcs", verdict: "review", why: "suporte/controle remoto do fabricante" },
  { pkg: "com.softwinner.TvdVideo", verdict: "review", why: "player de vídeo do fabricante" },
  { pkg: "com.softwinner.awlogsettings", verdict: "review", why: "configuração de logs do fabricante" },
  { pkg: "com.allwinnertech.gmsintegration", verdict: "review", why: "integração GMS do fabricante" },
];

const KEEP_MAP = new Map(KEEP.map((r) => [r.pkg, r]));
const REMOVE_MAP = new Map(REMOVE.map((r) => [r.pkg, r]));
const REVIEW_MAP = new Map(REVIEW.map((r) => [r.pkg, r]));

const VENDOR_PREFIX: Array<{ prefix: string; why: string }> = [
  { prefix: "com.hx.", why: "app do fabricante — funções da box podem depender" },
  { prefix: "com.softwinner.", why: "app do fabricante Allwinner — confira antes" },
  { prefix: "com.allwinnertech.", why: "app do fabricante Allwinner — confira antes" },
  { prefix: "com.google.", why: "app Google não catalogado — confira antes" },
  { prefix: "com.android.", why: "componente AOSP não catalogado — confira antes" },
];

function classify(pkg: string, defaultBrowser: string | null): { verdict: Verdict; why: string } {
  const keep = KEEP_MAP.get(pkg);
  if (keep) return keep;
  const remove = REMOVE_MAP.get(pkg);
  if (remove) return remove;
  const review = REVIEW_MAP.get(pkg);
  if (review) {
    if (pkg === "com.android.chrome" && defaultBrowser && defaultBrowser !== pkg) {
      return { verdict: "review", why: `navegador do sistema (padrão atual: ${defaultBrowser})` };
    }
    return review;
  }
  for (const rule of VENDOR_PREFIX) {
    if (pkg.startsWith(rule.prefix)) return { verdict: "review", why: rule.why };
  }
  return { verdict: "review", why: "não catalogado — confira antes de remover" };
}

async function listPackages(device: DeviceTarget, flag: string): Promise<string[]> {
  const out = await run("adb", ["-s", device.endpoint, "shell", "pm", "list", "packages", flag], 20000);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^package:/, ""))
    .filter(Boolean);
}

async function defaultBrowser(device: DeviceTarget): Promise<string | null> {
  const out = await run(
    "adb",
    [
      "-s",
      device.endpoint,
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "-a",
      "android.intent.action.VIEW",
      "-c",
      "android.intent.category.DEFAULT",
      "-d",
      "https://example.com",
    ],
    8000,
  ).catch(() => "");
  const match = out.match(/^([A-Za-z][\w.]*)\//m);
  return match ? match[1] : null;
}

function section(title: string, rows: string[]): string[] {
  return [title, ...(rows.length ? rows : ["  (nenhum)"]), ""];
}

export async function analyzePackages(device: DeviceTarget): Promise<string> {
  const [system, user, disabled, browser] = await Promise.all([
    listPackages(device, "-s"),
    listPackages(device, "-3").catch(() => [] as string[]),
    listPackages(device, "-d").catch(() => [] as string[]),
    defaultBrowser(device),
  ]);

  if (system.length === 0) {
    return `Não consegui listar os pacotes de ${device.ip}. Confirme o ADB com \`list ${device.ip}\`.`;
  }

  const disabledSet = new Set(disabled);
  const groups: Record<Verdict, Array<{ pkg: string; why: string }>> = {
    remove: [],
    review: [],
    keep: [],
  };

  for (const pkg of system.sort((a, b) => a.localeCompare(b))) {
    const { verdict, why } = classify(pkg, browser);
    groups[verdict].push({ pkg, why });
  }

  const width = Math.max(30, ...system.map((p) => p.length)) + 2;
  const row = (pkg: string, why: string) => {
    const off = disabledSet.has(pkg) ? " (já desativado)" : "";
    return `  ${pkg.padEnd(width)}${why}${off}`;
  };

  const ignored = user.length ? ` · usuário: ${user.length}` : "";
  const disabledCount = disabledSet.size ? ` · desativados: ${disabledSet.size}` : "";

  return [
    `${device.ip} — o que pode sair sem quebrar a box`,
    "",
    `Sistema: ${system.length}${ignored}${disabledCount}`,
    `Navegador padrão: ${browser ?? "(não identificado)"}`,
    "",
    ...section(
      `PODE REMOVER (${groups.remove.length}) — sem função de uso, configuração ou gerenciamento`,
      groups.remove.map((r) => row(r.pkg, r.why)),
    ),
    ...section(
      `REVISAR (${groups.review.length}) — depende do uso da box`,
      groups.review.map((r) => row(r.pkg, r.why)),
    ),
    `MANTER (${groups.keep.length}) — boot, configurações, launcher, áudio, arquivos, OTA e ADB`,
    `  ${groups.keep.map((r) => r.pkg).join(", ")}`,
    "",
    `Remova um pacote por vez e confira a box:`,
    `  uninstall ${device.ip} <pacote> confirmar`,
    `Reverter um pacote de sistema:`,
    `  adb -s ${device.endpoint} shell cmd package install-existing <pacote>`,
    "",
    "Remover pacotes libera armazenamento e evita serviços em segundo plano;",
    "a lentidão só melhora quando o serviço removido realmente estava rodando.",
  ].join("\n");
}
