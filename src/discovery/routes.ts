import { Router } from "express";
import { VERSION } from "../core/settings.js";
import { isVirtualInfrastructure } from "./models.js";
import { scanState, startScan } from "./scan.js";

const router = Router();

function collectGroups() {
  const groups = scanState.groups.map((g) => ({ ...g }));

  for (const u of scanState.usbAdb) {
    if (u.ip && groups.some((g) => g.ip === u.ip)) continue;
    if (groups.some((g) => g.ip === u.serial)) continue;
    groups.push({
      ip: u.serial,
      name: u.model || u.serial,
      kind: "android" as const,
      model: u.model,
      adbEndpoint: u.serial,
      adbState: u.state,
      connections: [{ protocol: "ADB USB", state: u.state, detail: `serial ${u.serial}` }],
      evidence: [`ADB USB (${u.serial})`],
    } as (typeof groups)[number]);
  }

  return groups.filter((g) => !isVirtualInfrastructure(g));
}

router.get("/api/devices", (_req, res) => {
  res.json({
    groups: collectGroups(),
    usbAdb: scanState.usbAdb,
    scannedAt: scanState.scannedAt,
    status: scanState.status,
    progress: scanState.progress,
    step: scanState.step,
    interface: scanState.interface,
    error: scanState.error,
    version: VERSION,
  });
});

router.get("/api/scan/status", (_req, res) => {
  res.json({
    status: scanState.status,
    progress: scanState.progress,
    step: scanState.step,
    count: scanState.groups.length,
    usb: scanState.usbAdb.length,
    scannedAt: scanState.scannedAt,
    interface: scanState.interface,
  });
});

router.post("/api/scan/start", (_req, res) => {
  if (scanState.status === "scanning") {
    res.json({ ok: false, msg: "Varredura já em andamento." });
    return;
  }
  startScan();
  res.json({ ok: true, msg: "Varredura iniciada em background." });
});

export const discoveryRouter = router;
