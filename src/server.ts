import express from "express";
import path from "node:path";
import { discoveryRouter } from "./discovery/routes.js";
import { adbRouter } from "./adb/routes.js";
import { systemRouter } from "./core/routes.js";
import { apiAccess } from "./core/security.js";
import { lanIPv4 } from "./core/network.js";
import { startScan } from "./discovery/scan.js";
import { startKeepAlive } from "./adb/keepalive.js";
import { HOST, PORT, PUBLIC_DIR, VERSION } from "./core/settings.js";

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(apiAccess);

app.get("/", (_req, res) => {
  res.redirect("/discovery");
});

app.get("/discovery", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "discovery.html"));
});

app.use(express.static(PUBLIC_DIR));
app.use(discoveryRouter);
app.use(adbRouter);
app.use(systemRouter);

const lan = lanIPv4();

app.listen(PORT, HOST, () => {
  console.log(`Android Network ADB v${VERSION}: http://localhost:${PORT}`);
  if (HOST === "0.0.0.0" && lan) {
    console.log(`LAN: http://${lan}:${PORT}`);
  }
  console.log(
    "Se a box não abrir a página, permita Node.js no firewall do Windows (rede privada) ou libere a porta 3000.",
  );
  startScan();
  startKeepAlive();
});
