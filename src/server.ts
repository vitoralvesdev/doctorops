import express from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import { discoveryRouter } from "./discovery/routes.js";
import { adbRouter } from "./adb/routes.js";
import { systemRouter } from "./core/routes.js";
import { apiAccess } from "./core/security.js";
import { lanIPv4 } from "./core/network.js";
import { startScan } from "./discovery/scan.js";
import { startKeepAlive } from "./adb/keepalive.js";
import { DATA_DIR, HOST, PACKAGED, PORT, PUBLIC_DIR, VERSION } from "./core/settings.js";

process.title = "DoctorOps";

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
const localUrl = `http://localhost:${PORT}`;

function openBrowser(target: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

const server = app.listen(PORT, HOST, () => {
  console.log(`DoctorOps v${VERSION}: ${localUrl}`);
  if (HOST === "0.0.0.0" && lan) {
    console.log(`LAN: http://${lan}:${PORT}`);
  }
  if (PACKAGED) {
    console.log(`Dados: ${DATA_DIR}`);
    if (process.env.TX_NO_OPEN !== "1") openBrowser(localUrl);
  }
  console.log(
    `Se a box não abrir a página, permita Node.js no firewall do Windows (rede privada) ou libere a porta ${PORT}.`,
  );
  startScan();
  startKeepAlive();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`A porta ${PORT} já está em uso; abrindo a instância que já está rodando.`);
    if (PACKAGED && process.env.TX_NO_OPEN !== "1") openBrowser(localUrl);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
