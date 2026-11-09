/* Base OUI mínima e verificável. Amplie conforme novos fabricantes forem confirmados. */
const OUI: Record<string, { vendor: string; note?: string }> = {
  "94:a1:a2": { vendor: "AMPAK Technology", note: "módulo Wi-Fi comum em TV boxes" },
};

export function lookupOui(mac: string | null | undefined): { vendor: string; note?: string } | null {
  if (!mac) return null;
  const prefix = mac.replace(/[:-]/g, ":").toLowerCase().slice(0, 8);
  return OUI[prefix] ?? null;
}

export function isLocallyAdministeredMac(mac: string | null | undefined): boolean {
  if (!mac) return false;
  const first = Number.parseInt(mac.replace(/[:-]/g, "").slice(0, 2), 16);
  return Number.isFinite(first) && (first & 2) !== 0;
}
