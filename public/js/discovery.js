/* Página /discovery: varredura de rede, identificação e terminal ADB. */
(() => {
  const devicesEl = document.querySelector("#devices");
  const countEl = document.querySelector("#count");
  const statusEl = document.querySelector("#status");
  const refreshBtn = document.querySelector("#refresh");
  const outputEl = document.querySelector("#output");
  const form = document.querySelector("#form");
  const input = document.querySelector("#command");
  const execBtn = document.querySelector("#exec-btn");
  const abortHint = document.querySelector("#abort-hint");
  const opsTarget = document.querySelector("#ops-target");
  const opsPackage = document.querySelector("#ops-package");
  const opsFile = document.querySelector("#ops-file");
  const opsStatusEl = document.querySelector("#ops-status");
  const screenPreview = document.querySelector("#screen-preview");

  let groups = [];
  let cmdRunning = false;
  let lastScanStatus = "";
  const commandHistory = [];
  let historyIndex = 0;
  let historyDraft = "";

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!commandHistory.length) return;
      if (historyIndex === commandHistory.length) historyDraft = input.value;
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = commandHistory[historyIndex];
    } else if (event.key === "ArrowDown" && historyIndex < commandHistory.length) {
      event.preventDefault();
      historyIndex += 1;
      input.value =
        historyIndex === commandHistory.length ? historyDraft : commandHistory[historyIndex];
    }
  });

  input.addEventListener("input", () => {
    if (historyIndex < commandHistory.length) {
      historyIndex = commandHistory.length;
      historyDraft = input.value;
    }
  });

  function terminal(text, cls = "") {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    outputEl.append(d);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function commandOutputClass(data) {
    if (data.ok) return "success";
    const output = typeof data.output === "string" ? data.output.trimStart() : "";
    return /^(?:Comandos:|uso:)/i.test(output) ? "warn" : "error";
  }

  function setExecLoading(on) {
    cmdRunning = on;
    execBtn.disabled = on;
    execBtn.innerHTML = on ? AN.SPINNER_SVG : "Executar";
    execBtn.classList.toggle("btn-loading", on);
    if (abortHint) abortHint.style.display = on ? "inline" : "none";
  }

  const PROTO_COLOR = {
    ADB: "#65d6a5",
    SSDP: "#8cb8ff",
    mDNS: "#c792ea",
    Cast: "#f78c6c",
    HTTP: "#f1ca79",
    AndroidTV: "#89ddff",
    AirPlay: "#ff9c9c",
    UPnP: "#8cb8ff",
    Lockdown: "#ff9c9c",
  };

  function protoColor(p) {
    for (const [k, v] of Object.entries(PROTO_COLOR)) {
      if (p.toUpperCase().includes(k.toUpperCase())) return v;
    }
    return "#8e9bad";
  }

  const KIND_META = {
    "android-tv": { label: "Android TV", icon: "▣", cls: "kind-android" },
    android: { label: "Android", icon: "▣", cls: "kind-android" },
    apple: { label: "Apple", icon: "◎", cls: "kind-apple" },
    unknown: { label: "Desconhecido", icon: "◈", cls: "kind-unknown" },
  };

  const ADB_STATE_LABEL = {
    device: "ADB conectado",
    unauthorized: "ADB aguardando autorização no aparelho",
    offline: "ADB offline",
    pairing: "ADB sem fio: pronto para parear",
  };

  function makeBadge(conn) {
    const b = document.createElement("span");
    b.className = "conn-badge";
    b.textContent = conn.port ? `${conn.protocol}:${conn.port}` : conn.protocol;
    b.style.setProperty("--badge-color", protoColor(conn.protocol));
    if (conn.detail) b.title = conn.detail;
    return b;
  }

  function isPrivateMac(mac) {
    const firstOctet = Number.parseInt(mac.replace(/[:-]/g, "").slice(0, 2), 16);
    return Number.isFinite(firstOctet) && (firstOctet & 2) !== 0;
  }

  function deviceContext(device) {
    const identity = `${device.deviceType || ""} ${device.name || ""} ${device.model || ""}`.toLowerCase();
    if (
      device.kind === "android-tv" ||
      /\b(android tv|tv box|fire tv|chromecast|google tv|apple tv|bravia|smart tv)\b/.test(identity)
    ) return "tv";
    if (
      device.kind === "android" ||
      /\b(iphone|ipad|samsung android|motorola android|xiaomi android|google android|celular|smartphone)\b/.test(identity)
    ) return "mobile";
    if (
      /\b(mac|macbook|mac mini|mac studio|mac pro|imac|notebook|laptop|computador linux|desktop|workstation|thinkpad)\b/.test(identity)
    ) return "computer";
    return "other";
  }

  const DEVICE_CONTEXTS = [
    { key: "tv", label: "TVs e TV Boxes" },
    { key: "mobile", label: "Celulares e tablets" },
    { key: "computer", label: "Computadores" },
    { key: "other", label: "Outros dispositivos" },
  ];

  function render() {
    countEl.textContent = groups.length;
    if (!groups.length) {
      devicesEl.innerHTML =
        '<div class="empty">Nenhum aparelho encontrado ainda.<br>Ligue o aparelho ou conecte por USB com depuração ativa.</div>';
      return;
    }
    devicesEl.replaceChildren();
    for (const context of DEVICE_CONTEXTS) {
      const contextGroups = groups.filter((g) => deviceContext(g) === context.key);
      if (!contextGroups.length) continue;

      const section = document.createElement("section");
      section.className = "device-context";
      const heading = document.createElement("div");
      heading.className = "device-context-heading";
      const title = document.createElement("h3");
      title.textContent = context.label;
      const total = document.createElement("span");
      total.textContent = `${contextGroups.length} dispositivo${contextGroups.length === 1 ? "" : "s"}`;
      heading.append(title, total);
      section.append(heading);

      for (const g of contextGroups) {
        const meta = KIND_META[g.kind] || KIND_META.unknown;
        const card = document.createElement("div");
        card.className = "device";
        if (g.evidence?.length) card.title = g.evidence.join("\n");

        const ico = document.createElement("div");
        ico.className = "device-icon " + meta.cls + (g.adbState === "device" ? " adb-ok" : "");
        ico.textContent = meta.icon;

        const main = document.createElement("div");
        main.className = "device-main";

        const nameRow = document.createElement("div");
        nameRow.className = "device-name-row";
        const name = document.createElement("span");
        name.className = "device-name";
        name.textContent = g.name && g.name !== g.ip ? g.name : g.deviceType || g.ip;
        const chip = document.createElement("span");
        chip.className = "kind-chip " + meta.cls;
        chip.textContent = g.deviceType || meta.label;
        nameRow.append(name, chip);

        const ipRow = document.createElement("div");
        ipRow.className = "meta";
        ipRow.textContent = g.ip + (g.vendor ? `  ·  ${g.vendor}` : "");

        main.append(nameRow, ipRow);

        if (g.kind === "unknown" && g.name === g.ip) {
          if (g.mac) {
            const macRow = document.createElement("div");
            macRow.className = "meta";
            macRow.textContent = `MAC: ${g.mac}${isPrivateMac(g.mac) ? " (privativa/aleatória; sem fabricante identificável)" : ""}`;
            main.append(macRow);
          }
          if (g.evidence?.length) {
            const evidenceRow = document.createElement("div");
            evidenceRow.className = "meta";
            evidenceRow.textContent = `Pistas: ${g.evidence.join(" · ")}`;
            main.append(evidenceRow);
          } else {
            const nameHint = document.createElement("div");
            nameHint.className = "meta";
            nameHint.textContent = "Nome não anunciado pelos serviços de rede";
            main.append(nameHint);
          }
        }

        if (g.model) {
          const modelRow = document.createElement("div");
          modelRow.className = "meta";
          modelRow.textContent = g.model;
          main.append(modelRow);
        }

        const badges = document.createElement("div");
        badges.className = "conn-badges";
        for (const conn of g.connections) badges.append(makeBadge(conn));
        if (badges.childElementCount) main.append(badges);

        if (g.adbState) {
          const adb = document.createElement("div");
          adb.className = "adb-line adb-" + g.adbState;
          adb.textContent = ADB_STATE_LABEL[g.adbState] || `ADB: ${g.adbState}`;
          main.append(adb);
        }

        if (g.pairingPort && g.adbState !== "device") {
          const pair = document.createElement("div");
          pair.className = "adb-line adb-pairing";
          pair.textContent = `Pareamento disponível em ${g.ip}:${g.pairingPort}`;
          main.append(pair);
        }

        card.append(ico, main);
        card.onclick = () => {
          if (g.adbState === "pairing" && g.pairingPort) input.value = `pair ${g.ip}:${g.pairingPort} `;
          else input.value = `list ${g.ip}`;
          if (opsTarget) opsTarget.value = g.ip;
          input.focus();
        };
        section.append(card);
      }
      devicesEl.append(section);
    }
  }

  function renderProgress(progress, step, status) {
    const bar = document.querySelector("#scan-bar");
    const pct = document.querySelector("#scan-pct");
    const lbl = document.querySelector("#scan-label");
    if (!bar) return;
    bar.style.width = progress + "%";
    if (pct) pct.textContent = status === "scanning" ? progress + "%" : "";
    if (lbl) {
      lbl.textContent =
        status === "scanning" ? step || "Varrendo…" : status === "done" ? "Concluído" : "";
    }
  }

  async function fetchGroups() {
    try {
      const r = await fetch("/api/devices");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      groups = data.groups || [];
      render();
      if (data.scannedAt) {
        const iface = data.interface ? ` · rede ${data.interface}` : "";
        statusEl.textContent = `Última varredura: ${new Date(
          data.scannedAt,
        ).toLocaleTimeString()} · ${groups.length} aparelho(s)${iface}`;
      }
      renderProgress(data.progress ?? 100, data.step ?? "Concluído", data.status ?? "done");
    } catch (e) {
      terminal(`Erro ao carregar dispositivos: ${e.message}`, "error");
    }
  }

  async function tick() {
    try {
      const r = await fetch("/api/scan/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const scanning = data.status === "scanning";

      refreshBtn.disabled = scanning;
      refreshBtn.innerHTML = scanning ? `${AN.SPINNER_SVG} Varrendo…` : "↻ Refresh";
      refreshBtn.classList.toggle("btn-loading", scanning);

      renderProgress(data.progress, data.step, data.status);
      if (scanning) statusEl.textContent = `Varrendo… ${data.progress}% — ${data.step || ""}`;

      if (data.status === "done" && lastScanStatus === "scanning") await fetchGroups();

      lastScanStatus = data.status;
    } catch {
      /* servidor momentaneamente ocupado — tenta de novo no próximo ciclo */
    }
    setTimeout(tick, 2000);
  }

  async function startRefresh() {
    try {
      const r = await fetch("/api/scan/start", { method: "POST" });
      const data = await r.json();
      if (!data.ok) {
        terminal(data.msg || "Não foi possível iniciar varredura.", "warn");
        return;
      }
      terminal("Nova varredura iniciada em background…", "info");
      groups = [];
      render();
      lastScanStatus = "scanning";
    } catch (e) {
      terminal(`Erro: ${e.message}`, "error");
    }
  }

  refreshBtn.onclick = startRefresh;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const command = input.value.trim();
    if (!command) return;

    commandHistory.push(command);
    historyIndex = commandHistory.length;
    historyDraft = "";

    if (/^clear$/i.test(command)) {
      outputEl.replaceChildren();
      input.value = "";
      input.focus();
      return;
    }

    if (/^abort$/i.test(command)) {
      terminal("> abort");
      input.value = "";
      try {
        const r = await fetch("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "abort" }),
        });
        const data = await r.json();
        terminal(data.output || "Abortado.", "warn");
      } catch (err) {
        terminal(err.message, "error");
      }
      setExecLoading(false);
      return;
    }

    terminal("> " + command);
    input.value = "";
    setExecLoading(true);
    try {
      const r = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await r.json();
      terminal(data.output || "Sem saída", commandOutputClass(data));
    } catch (err) {
      terminal(err.message, "error");
    } finally {
      setExecLoading(false);
      input.focus();
    }
  };

  function opsStatus(text, cls = "info") {
    if (!opsStatusEl) return;
    opsStatusEl.textContent = text;
    opsStatusEl.className = `status status-${cls}`;
  }

  async function runOps(command) {
    const r = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const data = await r.json();
    terminal(data.output || "Sem saída", data.ok ? "success" : "error");
    opsStatus(data.ok ? "Concluído." : "Não foi possível executar.", data.ok ? "ok" : "error");
    return data;
  }

  function currentTarget() {
    const target = opsTarget ? opsTarget.value.trim() : "";
    if (!target) {
      opsStatus("Informe o IP da box (ou clique em um dispositivo).", "error");
      return null;
    }
    return target;
  }

  const appsBtn = document.querySelector("#ops-apps");
  if (appsBtn) {
    appsBtn.onclick = () => {
      const target = currentTarget();
      if (!target) return;
      terminal(`> apps ${target}`);
      opsStatus("Lendo pacotes…", "info");
      runOps(`apps ${target}`);
    };
  }

  const screenBtn = document.querySelector("#ops-screen");
  if (screenBtn) {
    screenBtn.onclick = async () => {
      const target = currentTarget();
      if (!target) return;
      terminal(`> screen ${target}`);
      opsStatus("Capturando tela…", "info");
      const data = await runOps(`screen ${target}`);
      if (data.ok && data.url && screenPreview) {
        screenPreview.hidden = false;
        screenPreview.replaceChildren();
        const img = document.createElement("img");
        img.src = `${data.url}?t=${Date.now()}`;
        img.alt = `Tela de ${target}`;
        const link = document.createElement("a");
        link.href = data.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Abrir em tamanho cheio";
        screenPreview.append(img, link);
      }
    };
  }

  const rebootBtn = document.querySelector("#ops-reboot");
  if (rebootBtn) {
    rebootBtn.onclick = () => {
      const target = currentTarget();
      if (!target) return;
      if (!confirm(`Reiniciar ${target} agora? A sessão ADB cai e a box fica fora por alguns segundos.`)) return;
      terminal(`> reboot ${target} confirmar`);
      runOps(`reboot ${target} confirmar`);
    };
  }

  const uninstallBtn = document.querySelector("#ops-uninstall");
  if (uninstallBtn) {
    uninstallBtn.onclick = () => {
      const target = currentTarget();
      if (!target) return;
      const pkg = opsPackage ? opsPackage.value.trim() : "";
      if (!pkg) {
        opsStatus("Informe o pacote (ex.: com.exemplo.app).", "error");
        return;
      }
      if (
        !confirm(
          `Remover ${pkg} de ${target}?\nSe for app de sistema, a remoção pode falhar ou afetar a box.`,
        )
      ) {
        return;
      }
      terminal(`> uninstall ${target} ${pkg} confirmar`);
      runOps(`uninstall ${target} ${pkg} confirmar`);
    };
  }

  async function uploadToBox(action) {
    const target = currentTarget();
    if (!target) return;
    const file = opsFile?.files?.[0];
    if (!file) {
      opsStatus("Escolha um arquivo primeiro.", "error");
      return;
    }
    const verb = action === "install" ? "install" : "push";
    terminal(`> ${verb} ${target} ${file.name}`);
    opsStatus(`Enviando ${file.name}…`, "info");
    try {
      const r = await fetch(
        `/api/transfer?target=${encodeURIComponent(target)}&action=${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "x-file-name": file.name },
          body: file,
        },
      );
      const data = await r.json();
      terminal(data.output || "Sem saída", data.ok ? "success" : "error");
      opsStatus(data.ok ? "Concluído." : "Falhou.", data.ok ? "ok" : "error");
    } catch (e) {
      terminal(e.message, "error");
      opsStatus("Falha no envio.", "error");
    }
  }

  const installBtn = document.querySelector("#ops-install");
  if (installBtn) installBtn.onclick = () => uploadToBox("install");
  const pushBtn = document.querySelector("#ops-push");
  if (pushBtn) pushBtn.onclick = () => uploadToBox("push");

  AN.initLogs({
    logsEl: document.querySelector("#logs"),
    countEl: document.querySelector("#log-count"),
    clearBtn: document.querySelector("#clear-logs"),
  });

  fetch("/api/scan/status")
    .then((r) => r.json())
    .then((data) => {
      lastScanStatus = data.status;
      if (data.status === "done" && data.count > 0) fetchGroups();
      else if (data.status === "scanning") {
        statusEl.textContent = `Varrendo… ${data.progress}% — ${data.step || ""}`;
        renderProgress(data.progress, data.step, data.status);
      }
      setTimeout(tick, 2000);
    })
    .catch(() => setTimeout(tick, 2000));
})();
