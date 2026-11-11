export type LauncherTile = {
  index: number;
  label: string;
  pkg: string | null;
};

export type LauncherProfile = {
  package: string;
  name: string;
  versionCode: number;
  layoutSuffix: string;
  tiles: LauncherTile[];
  targetIds: number[];
  nextFocusUp: number;
};

export const OVERLAY_PACKAGE = "com.androidnetwork.launcheroverlay";

export const HLAUNCHER: LauncherProfile = {
  package: "com.hx.mboxlauncher",
  name: "HLauncher (Transpeed/Allwinner)",
  versionCode: 29,
  layoutSuffix: "layout_rect_group.xml",
  tiles: [
    { index: 0, label: "YouTube", pkg: "com.google.android.youtube.tv" },
    { index: 1, label: "Play Store", pkg: "com.android.vending" },
    { index: 2, label: "Netflix", pkg: "com.netflix.mediaclient" },
    { index: 3, label: "Vídeo", pkg: null },
    { index: 4, label: "Chrome", pkg: "com.android.chrome" },
    { index: 5, label: "Meus arquivos", pkg: "com.softwinner.TvdFileManager" },
    { index: 6, label: "Meus apps", pkg: null },
    { index: 7, label: "Configurações", pkg: "com.android.tv.settings" },
  ],
  targetIds: [
    0x7f0900b6,
    0x7f0900ba, 0x7f0900a5,
    0x7f0900b5, 0x7f0900a2,
    0x7f0900b4, 0x7f0900a1,
    0x7f0900b9, 0x7f0900a4,
    0x7f0900af, 0x7f09009c,
    0x7f0900b1, 0x7f0900a0,
    0x7f0900ae, 0x7f09009b,
    0x7f0900b8, 0x7f0900a3,
  ],
  nextFocusUp: 0x7f09014a,
};

const PROFILES = [HLAUNCHER];

export function profileFor(pkg: string): LauncherProfile | null {
  return PROFILES.find((p) => p.package === pkg) ?? null;
}

export function tileForPackage(profile: LauncherProfile, pkg: string): LauncherTile | null {
  return profile.tiles.find((t) => t.pkg === pkg) ?? null;
}
