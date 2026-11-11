import fs from "node:fs";
import path from "node:path";
import { TMP_DIR } from "../core/settings.js";
import { run } from "../adb/client.js";
import { OVERLAY_BASE_APK } from "./assets.js";
import { patchOverlayLayout } from "./axml.js";
import { readZip, replaceEntry, writeZip } from "./zip.js";
import { signApk } from "./sign.js";
import { OVERLAY_PACKAGE, profileFor, type LauncherProfile } from "./profile.js";
type Target = { endpoint: string; ip: string };

export function buildOverlayApk(profile: LauncherProfile, hidden: Set<number>): Buffer {
  const entries = readZip(OVERLAY_BASE_APK);
  const layout = entries.find((e) => e.name.endsWith(profile.layoutSuffix));
  if (!layout) throw new Error(`Layout ${profile.layoutSuffix} não existe no overlay-base.`);

  const patched = patchOverlayLayout(layout.data, {
    targetIds: profile.targetIds,
    hiddenTiles: hidden,
    nextFocusUp: profile.nextFocusUp,
  });
  return signApk(writeZip(replaceEntry(entries, layout.name, patched)));
}

export async function homePackage(device: Target): Promise<string | null> {
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
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.HOME",
    ],
    8000,
  );
  const line = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes("/"))
    .pop();
  return line ? line.split("/")[0] : null;
}

export async function installedPackages(device: Target): Promise<Set<string>> {
  const out = await run("adb", ["-s", device.endpoint, "shell", "pm", "list", "packages"], 15000);
  return new Set(
    out
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^package:/, ""))
      .filter(Boolean),
  );
}

export function deadTiles(profile: LauncherProfile, installed: Set<string>): Set<number> {
  const hidden = new Set<number>();
  for (const tile of profile.tiles) {
    if (tile.pkg && !installed.has(tile.pkg)) hidden.add(tile.index);
  }
  return hidden;
}

async function overlayEnabled(device: Target): Promise<boolean> {
  try {
    const out = await run("adb", ["-s", device.endpoint, "shell", "cmd", "overlay", "list"], 8000);
    return out.split(/\r?\n/).some((l) => l.includes(`[x] ${OVERLAY_PACKAGE}`) || l.includes(`[X] ${OVERLAY_PACKAGE}`));
  } catch {
    return false;
  }
}

function restartHome(device: Target, home: string): Promise<string> {
  return run(
    "adb",
    [
      "-s",
      device.endpoint,
      "shell",
      `am force-stop ${home}; am start -a android.intent.action.MAIN -c android.intent.category.HOME`,
    ],
    12000,
  );
}

async function launcherVersion(device: Target, pkg: string): Promise<number | null> {
  try {
    const out = await run("adb", ["-s", device.endpoint, "shell", "dumpsys", "package", pkg], 10000);
    const match = out.match(/versionCode=(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export async function applyOverlay(
  device: Target,
  profile: LauncherProfile,
  hidden: Set<number>,
): Promise<{ ok: boolean; output: string }> {
  const version = await launcherVersion(device, profile.package);
  if (version !== null && version !== profile.versionCode) {
    return {
      ok: false,
      output: [
        `${device.ip}: launcher ${profile.package} na versão ${version}, mas o perfil foi validado na versão ${profile.versionCode}.`,
        "Não vou arriscar trocar o layout de uma versão desconhecida.",
      ].join("\n"),
    };
  }

  const apk = buildOverlayApk(profile, hidden);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, `launcher-overlay-${Date.now()}.apk`);
  fs.writeFileSync(file, apk);
  try {
    const install = await run("adb", ["-s", device.endpoint, "install", "-r", file], 120000);
    if (!/Success/i.test(install)) {
      return { ok: false, output: `Falha ao instalar o overlay do launcher.\n${install}` };
    }
  } finally {
    fs.rmSync(file, { force: true });
  }

  const enable = await run(
    "adb",
    ["-s", device.endpoint, "shell", "cmd", "overlay", "enable", "--user", "0", OVERLAY_PACKAGE],
    10000,
  );
  const home = (await homePackage(device)) ?? profile.package;
  await restartHome(device, home).catch(() => "");

  const enabled = await overlayEnabled(device);
  if (!enabled) {
    return {
      ok: false,
      output: [
        "Overlay instalado, mas não ficou habilitado.",
        enable.trim(),
        "Rode `launcher <alvo> info` para conferir o estado.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const labels = [...hidden]
    .sort((a, b) => a - b)
    .map((i) => profile.tiles.find((t) => t.index === i))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => t.label);

  return {
    ok: true,
    output: [
      `${device.ip}: ícones escondidos — ${labels.join(", ") || "(nenhum)"}.`,
      "Overlay ativo. Para desfazer: launcher <alvo> rollback",
    ].join("\n"),
  };
}

export async function rollbackOverlay(device: Target, profile: LauncherProfile): Promise<{ ok: boolean; output: string }> {
  const disable = await run(
    "adb",
    ["-s", device.endpoint, "shell", "cmd", "overlay", "disable", "--user", "0", OVERLAY_PACKAGE],
    8000,
  ).catch((e) => (e as Error).message);
  const uninstall = await run("adb", ["-s", device.endpoint, "uninstall", OVERLAY_PACKAGE], 60000);
  const home = (await homePackage(device)) ?? profile.package;
  await restartHome(device, home).catch(() => "");
  return {
    ok: /Success/i.test(uninstall),
    output: /Success/i.test(uninstall)
      ? `${device.ip}: overlay removido; launcher original restaurado.`
      : [`${device.ip}: não consegui remover o overlay.`, disable, uninstall].filter(Boolean).join("\n"),
  };
}

export type LauncherInfo = {
  home: string | null;
  profile: LauncherProfile | null;
  hidden: Set<number>;
  overlayInstalled: boolean;
  overlayEnabled: boolean;
};

export async function inspectLauncher(device: Target): Promise<LauncherInfo> {
  const home = await homePackage(device);
  const profile = home ? profileFor(home) : null;
  const installed = profile ? await installedPackages(device) : new Set<string>();
  const hidden = profile ? deadTiles(profile, installed) : new Set<number>();
  const overlayInstalled = profile ? installed.has(OVERLAY_PACKAGE) : false;
  return {
    home,
    profile,
    hidden,
    overlayInstalled,
    overlayEnabled: profile ? await overlayEnabled(device) : false,
  };
}

export function formatLauncherInfo(device: Target, info: LauncherInfo): string {
  const lines: string[] = [`${device.ip} — launcher`];
  if (!info.home) {
    lines.push("", "Não consegui descobrir o app HOME do aparelho.");
    return lines.join("\n");
  }
  lines.push(`  HOME: ${info.home}`);
  if (!info.profile) {
    lines.push("", "Launcher dinâmico ou sem perfil conhecido.", "Os ícones acompanham os pacotes; nada a limpar.");
    return lines.join("\n");
  }
  lines.push(`  Perfil: ${info.profile.name}`, "");
  for (const tile of info.profile.tiles) {
    const dead = info.hidden.has(tile.index);
    const pkg = tile.pkg ?? "(interno)";
    lines.push(`  ${dead ? "✗" : "✓"} ${tile.label.padEnd(15)} ${pkg}`);
  }
  lines.push(
    "",
    `Overlay: ${info.overlayInstalled ? "instalado" : "não instalado"} · ${info.overlayEnabled ? "ativo" : "inativo"}`,
    info.hidden.size > 0
      ? "Rode `launcher <alvo> clean` para esconder os ícones marcados com ✗."
      : "Nenhum ícone morto.",
  );
  return lines.join("\n");
}

export async function cleanAfterUninstall(device: Target, pkg: string): Promise<string | null> {
  const home = await homePackage(device);
  const profile = home ? profileFor(home) : null;
  if (!profile) return null;

  const installed = await installedPackages(device);
  installed.delete(pkg);
  const hidden = deadTiles(profile, installed);
  if (hidden.size === 0) return null;

  const result = await applyOverlay(device, profile, hidden);
  return result.output;
}
