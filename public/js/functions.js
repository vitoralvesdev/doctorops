/* Página /functions: execução guiada de operações ADB com histórico em estilo log. */
(() => {
  const selectEl = document.querySelector("#fn-select");
  const descEl = document.querySelector("#fn-desc");
  const fieldsEl = document.querySelector("#fn-fields");
  const chipsEl = document.querySelector("#fn-targets");
  const formEl = document.querySelector("#fn-form");
  const runBtn = document.querySelector("#fn-run");
  const resetBtn = document.querySelector("#fn-reset");
  const hintEl = document.querySelector("#fn-hint");
  const logEl = document.querySelector("#fn-log");
  const filterEl = document.querySelector("#fn-filter");
  const followEl = document.querySelector("#fn-follow");
  const clearBtn = document.querySelector("#fn-clear");
  const statEl = document.querySelector("#fn-stat");
  const liveEl = document.querySelector("#fn-live");
  const countEl = document.querySelector("#fn-count");
  const targetListEl = document.querySelector("#fn-target-list");

  const LS_TARGET = "an.functions.target";
  const LS_FUNCTION = "an.functions.last";
  const MAX_ENTRIES = 120;

  const TARGET = {
    key: "target",
    label: "Alvo",
    type: "text",
    placeholder: "192.168.1.28 ou serial USB",
    hint: "IP, ip:porta ou serial exibido por adb devices",
    required: true,
    target: true,
  };

  const FUNCTIONS = [
    {
      id: "list",
      group: "Diagnóstico",
      label: "Identificar aparelho",
      desc: "Coleta fabricante, modelo, Android, RAM, armazenamento, uptime e conexões detectadas.",
      fields: [TARGET],
      build: (v) => `list ${v.target}`,
    },
    {
      id: "analyze",
      group: "Diagnóstico",
      label: "Analisar o que pode ser removido",
      desc: "Classifica os pacotes de sistema em pode remover, revisar e manter. Não altera nada na box.",
      fields: [TARGET],
      build: (v) => `analyze ${v.target}`,
    },
    {
      id: "probe",
      group: "Diagnóstico",
      label: "Diagnóstico de rede",
      desc: "Sonda portas, banners, serviços UDP e o MAC do aparelho.",
      fields: [
        TARGET,
        { key: "full", label: "Varredura completa de portas", type: "checkbox" },
      ],
      build: (v) => `probe ${v.target}${v.full ? " full" : ""}`,
    },
    {
      id: "usb",
      group: "Diagnóstico",
      label: "Aparelhos no cabo USB",
      desc: "Mostra o que o adb e o Windows enxergam no USB, destacando o que mudou desde a última consulta.",
      fields: [],
      build: () => "usb",
    },
    {
      id: "connect",
      group: "Conexão",
      label: "Conectar ADB",
      desc: "Abre a sessão ADB pela rede. A porta padrão é 5555.",
      fields: [TARGET],
      build: (v) => `connect ${v.target}`,
    },
    {
      id: "disconnect",
      group: "Conexão",
      label: "Desconectar ADB",
      desc: "Encerra a sessão ADB do alvo informado.",
      fields: [TARGET],
      build: (v) => `disconnect ${v.target}`,
    },
    {
      id: "tcpip",
      group: "Conexão",
      label: "Ativar ADB por rede pelo USB",
      desc: "Liga o adbd em TCP a partir de um aparelho no cabo. Com root, a porta sobrevive ao reboot.",
      fields: [
        { ...TARGET, label: "Serial USB", placeholder: "SERIAL12345678", hint: "Serial exibido por adb devices" },
        { key: "port", label: "Porta", type: "text", default: "5555", placeholder: "5555", hint: "Padrão 5555" },
      ],
      build: (v) => `tcpip ${v.target}${v.port ? ` ${v.port}` : ""}`,
    },
    {
      id: "pair",
      group: "Conexão",
      label: "Parear depuração sem fio",
      desc: "Android 11+: pareie com a porta e o código exibidos na TV e depois conecte na porta de conexão.",
      fields: [
        { ...TARGET, label: "IP:porta de pareamento", placeholder: "192.168.1.28:37123" },
        {
          key: "code",
          label: "Código de pareamento",
          type: "text",
          placeholder: "123456",
          hint: "Código exibido na TV",
          required: true,
        },
      ],
      mask: true,
      build: (v) => `pair ${v.target} ${v.code}`,
    },
    {
      id: "apps",
      group: "Apps",
      label: "Listar aplicativos",
      desc: "Lista os pacotes de usuário e de sistema instalados na box.",
      fields: [TARGET],
      build: (v) => `apps ${v.target}`,
    },
    {
      id: "install",
      group: "Apps",
      label: "Instalar ou atualizar APK",
      desc: "Envia o APK do PC e instala na box, sem precisar digitar caminho.",
      fields: [
        TARGET,
        {
          key: "file",
          label: "APK do PC",
          type: "file",
          accept: ".apk,application/vnd.android.package-archive",
          required: true,
        },
      ],
      transfer: "install",
    },
    {
      id: "uninstall",
      group: "Apps",
      label: "Remover aplicativo",
      desc: "Remove um app pelo pacote. Apps de sistema podem exigir confirmação extra e o ícone do launcher é limpo em seguida.",
      fields: [
        TARGET,
        { key: "package", label: "Pacote", type: "text", placeholder: "com.exemplo.app", required: true },
        { key: "confirm", label: "Confirmo remover este pacote", type: "checkbox", required: true },
      ],
      build: (v) => `uninstall ${v.target} ${v.package} confirmar`,
    },
    {
      id: "launcher",
      group: "Apps",
      label: "Launcher e ícones",
      desc: "Inspeciona os tiles da HOME, esconde ícones de apps removidos e desfaz o overlay.",
      fields: [
        TARGET,
        {
          key: "action",
          label: "Ação",
          type: "select",
          default: "info",
          options: [
            { value: "info", label: "Inspecionar tiles" },
            { value: "clean", label: "Limpar ícones órfãos" },
            { value: "hide", label: "Esconder ícone" },
            { value: "show", label: "Mostrar ícone" },
            { value: "rollback", label: "Desfazer overlay (rollback)" },
          ],
        },
        {
          key: "package",
          label: "Pacote do ícone",
          type: "text",
          placeholder: "com.exemplo.app",
          required: true,
          showIf: (v) => v.action === "hide" || v.action === "show",
        },
      ],
      build: (v) =>
        `launcher ${v.target} ${v.action}${v.action === "hide" || v.action === "show" ? ` ${v.package}` : ""}`,
    },
    {
      id: "screen",
      group: "Tela e arquivos",
      label: "Capturar a tela",
      desc: "Tira um screenshot via ADB e mostra a prévia nesta atividade.",
      fields: [TARGET],
      build: (v) => `screen ${v.target}`,
    },
    {
      id: "push",
      group: "Tela e arquivos",
      label: "Enviar arquivo",
      desc: "Copia um arquivo do PC para a box. O destino padrão é /sdcard/Download.",
      fields: [
        TARGET,
        { key: "file", label: "Arquivo do PC", type: "file", required: true },
        {
          key: "destination",
          label: "Destino (opcional)",
          type: "text",
          placeholder: "/sdcard/Download",
          hint: "Deixe vazio para usar /sdcard/Download",
        },
      ],
      transfer: "push",
    },
    {
      id: "reboot",
      group: "Sistema",
      label: "Reiniciar a box",
      desc: "Reinicia o aparelho. A sessão ADB cai e volta em alguns segundos.",
      fields: [
        TARGET,
        { key: "confirm", label: "Confirmo reiniciar agora", type: "checkbox", required: true },
      ],
      build: (v) => `reboot ${v.target} confirmar`,
    },
  ];

  const state = {
    target: new URLSearchParams(location.search).get("target") || localStorage.getItem(LS_TARGET) || "",
    action: "info",
    port: "5555",
    package: "",
    destination: "",
    code: "",
    full: false,
    confirm: false,
    file: null,
  };
  localStorage.setItem(LS_TARGET, state.target);

  let entries = [];
  let running = false;
  let counter = 0;

  const currentFn = () => FUNCTIONS.find((f) => f.id === selectEl.value) ?? FUNCTIONS[0];

  function setHint(text, cls = "") {
    hintEl.textContent = text;
    hintEl.className = `fn-hint ${cls}`;
  }

  function resetState() {
    state.action = "info";
    state.port = "5555";
    state.package = "";
    state.destination = "";
    state.code = "";
    state.full = false;
    state.confirm = false;
    state.file = null;
  }

  function buildSelect() {
    const groups = [...new Set(FUNCTIONS.map((f) => f.group))];
    for (const group of groups) {
      const og = document.createElement("optgroup");
      og.label = group;
      for (const fn of FUNCTIONS.filter((f) => f.group === group)) {
        const opt = document.createElement("option");
        opt.value = fn.id;
        opt.textContent = fn.label;
        og.append(opt);
      }
      selectEl.append(og);
    }
    countEl.textContent = `${FUNCTIONS.length} funções`;
    const last = localStorage.getItem(LS_FUNCTION);
    selectEl.value = FUNCTIONS.some((f) => f.id === last) ? last : FUNCTIONS[0].id;
  }

  function renderFields() {
    const fn = currentFn();
    descEl.textContent = fn.desc;
    fieldsEl.replaceChildren();

    if (!fn.fields.length) {
      const note = document.createElement("div");
      note.className = "fn-muted";
      note.textContent = "Esta função não precisa de campos.";
      fieldsEl.append(note);
      return;
    }

    for (const field of fn.fields) {
      if (field.showIf && !field.showIf(state)) continue;

      const wrap = document.createElement("label");
      wrap.className = `fn-field${field.type === "checkbox" ? " fn-field-check" : ""}`;
      const label = document.createElement("span");
      label.textContent = field.label;

      let el;
      if (field.type === "select") {
        el = document.createElement("select");
        for (const opt of field.options) {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          el.append(o);
        }
        el.value = state[field.key] || field.default || field.options[0].value;
        state[field.key] = el.value;
        el.addEventListener("change", () => {
          state[field.key] = el.value;
          renderFields();
        });
      } else if (field.type === "file") {
        el = document.createElement("input");
        el.type = "file";
        if (field.accept) el.accept = field.accept;
        el.addEventListener("change", () => {
          state.file = el.files?.[0] ?? null;
          setHint(state.file ? `${state.file.name} · ${formatSize(state.file.size)}` : "", state.file ? "ok" : "");
        });
      } else if (field.type === "checkbox") {
        el = document.createElement("input");
        el.type = "checkbox";
        el.checked = Boolean(state[field.key]);
        el.addEventListener("change", () => {
          state[field.key] = el.checked;
        });
      } else {
        el = document.createElement("input");
        el.type = "text";
        el.value = state[field.key] ?? field.default ?? "";
        if (field.placeholder) el.placeholder = field.placeholder;
        el.addEventListener("input", () => {
          state[field.key] = el.value;
          if (field.target) localStorage.setItem(LS_TARGET, el.value);
        });
      }

      el.dataset.field = field.key;
      if (field.target) el.setAttribute("list", "fn-target-list");

      if (field.type === "checkbox") wrap.append(el, label);
      else wrap.append(label, el);

      if (field.hint) {
        const small = document.createElement("small");
        small.textContent = field.hint;
        wrap.append(small);
      }
      fieldsEl.append(wrap);
    }
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function validate(fn) {
    for (const field of fn.fields) {
      if (field.showIf && !field.showIf(state)) continue;
      if (field.type === "file") {
        if (!state.file) return `Escolha o arquivo em “${field.label}”.`;
        continue;
      }
      if (!field.required) continue;
      if (field.type === "checkbox") {
        if (!state[field.key]) return `Marque “${field.label}” para continuar.`;
        continue;
      }
      if (!String(state[field.key] ?? "").trim()) return `Preencha “${field.label}”.`;
    }
    if (state.port && !/^\d{1,5}$/.test(state.port.trim())) return "A porta deve ser numérica (ex.: 5555).";
    if (fn.id === "uninstall" && !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(state.package.trim())) {
      return "Pacote inválido. Ex.: com.exemplo.app";
    }
    return "";
  }

  function displayCommand(fn, command) {
    if (fn.mask) return command.replace(/ \S+$/, " ****");
    return command;
  }

  function updateStats() {
    const failures = entries.filter((e) => e.status === "error").length;
    statEl.textContent = `${entries.length} execuç${entries.length === 1 ? "ão" : "ões"} · ${failures} falha${failures === 1 ? "" : "s"}`;
    liveEl.textContent = running ? "● executando…" : "● pronto";
    liveEl.classList.toggle("busy", running);
  }

  function applyFilter() {
    const q = filterEl.value.trim().toLowerCase();
    for (const entry of entries) {
      if (!entry.el) continue;
      entry.el.hidden = Boolean(q) && !entry.el.textContent.toLowerCase().includes(q);
    }
  }

  function addEntry(fn, command, shown) {
    const id = ++counter;
    const entry = { id, label: fn.label, command, status: "running", output: "", el: null };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      const old = entries.shift();
      old.el?.remove();
    }

    const el = document.createElement("article");
    el.className = "fn-entry fn-entry-running";
    el.dataset.entry = String(id);
    el.innerHTML = `
      <div class="fn-entry-head">
        <span class="fn-time"></span>
        <span class="fn-name"></span>
        <span class="fn-status">${AN.SPINNER_SVG} executando</span>
        <span class="fn-dur">…</span>
        <button class="fn-copy" type="button" title="Copiar saída">⧉</button>
      </div>
      <code class="fn-cmd"></code>
      <div class="fn-body"></div>`;
    el.querySelector(".fn-time").textContent = AN.formatTime(new Date().toISOString());
    el.querySelector(".fn-name").textContent = fn.label;
    el.querySelector(".fn-cmd").textContent = shown;
    el.querySelector(".fn-copy").onclick = () =>
      AN.copyText(entry.output, "Saída", (msg, cls) => setHint(msg, cls));
    entry.el = el;

    logEl.querySelector(".fn-empty")?.remove();
    logEl.append(el);
    applyFilter();
    if (followEl.checked) logEl.scrollTop = logEl.scrollHeight;
    updateStats();
    return entry;
  }

  function finishEntry(entry, data, ms) {
    const ok = data.ok !== false;
    entry.status = ok ? "ok" : "error";
    entry.output = typeof data.output === "string" ? data.output : "";
    entry.el.classList.remove("fn-entry-running");
    entry.el.classList.add(ok ? "fn-entry-ok" : "fn-entry-error");
    entry.el.querySelector(".fn-status").textContent = ok ? "ok" : "erro";
    entry.el.querySelector(".fn-dur").textContent = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;

    const body = entry.el.querySelector(".fn-body");
    body.replaceChildren();
    if (entry.output.trim()) {
      const lines = entry.output.trim().split(/\r?\n/);
      const details = document.createElement("details");
      details.open = lines.length <= 8;
      const summary = document.createElement("summary");
      summary.textContent = `Saída · ${lines.length} linha${lines.length === 1 ? "" : "s"}`;
      const pre = document.createElement("pre");
      pre.className = "fn-out";
      pre.textContent = entry.output;
      details.append(summary, pre);
      body.append(details);
    } else {
      const muted = document.createElement("div");
      muted.className = "fn-muted";
      muted.textContent = "sem saída";
      body.append(muted);
    }

    if (data.url) {
      const shot = document.createElement("div");
      shot.className = "fn-shot";
      const img = document.createElement("img");
      img.src = `${data.url}?t=${Date.now()}`;
      img.alt = "Captura de tela da box";
      const link = document.createElement("a");
      link.href = data.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Abrir captura em tamanho cheio";
      shot.append(img, link);
      body.append(shot);
    }

    applyFilter();
    if (followEl.checked) logEl.scrollTop = logEl.scrollHeight;
    updateStats();
  }

  function setRunning(on) {
    running = on;
    runBtn.disabled = on;
    runBtn.innerHTML = on ? `${AN.SPINNER_SVG} Executando…` : "Executar";
    runBtn.classList.toggle("btn-loading", on);
    clearBtn.disabled = on;
    updateStats();
  }

  async function runCommand(command) {
    const r = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    return r.json();
  }

  async function upload(fn, v) {
    const params = new URLSearchParams({ target: v.target, action: fn.transfer });
    if (fn.id === "push" && v.destination) params.set("dest", v.destination);
    const r = await fetch(`/api/transfer?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "x-file-name": state.file.name },
      body: state.file,
    });
    return r.json();
  }

  async function execute() {
    if (running) return;
    const fn = currentFn();
    const problem = validate(fn);
    if (problem) {
      setHint(problem, "error");
      return;
    }

    const command = fn.transfer
      ? fn.id === "install"
        ? `install ${state.target} ${state.file.name}`
        : `push ${state.target} ${state.file.name}${state.destination ? ` ${state.destination}` : ""}`
      : fn.build({ ...state });

    setHint("");
    const entry = addEntry(fn, command, displayCommand(fn, command));
    setRunning(true);
    const started = performance.now();

    try {
      const data = fn.transfer ? await upload(fn, state) : await runCommand(command);
      finishEntry(entry, data, Math.round(performance.now() - started));
    } catch (e) {
      finishEntry(entry, { ok: false, output: e.message }, Math.round(performance.now() - started));
    } finally {
      if (fn.fields.some((f) => f.key === "confirm")) {
        state.confirm = false;
        const box = fieldsEl.querySelector('[data-field="confirm"]');
        if (box) box.checked = false;
      }
      setRunning(false);
    }
  }

  selectEl.addEventListener("change", () => {
    localStorage.setItem(LS_FUNCTION, selectEl.value);
    resetState();
    setHint("");
    renderFields();
  });

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    execute();
  });

  resetBtn.addEventListener("click", () => {
    state.target = "";
    resetState();
    localStorage.removeItem(LS_TARGET);
    renderFields();
    setHint("Campos limpos.", "");
  });

  filterEl.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", () => {
    if (running) return;
    entries = [];
    logEl.innerHTML = '<div class="fn-empty">Atividade limpa. Execute uma função para começar.</div>';
    updateStats();
  });

  async function loadTargets() {
    try {
      const r = await fetch("/api/devices");
      const data = await r.json();
      const seen = new Set();
      const targets = [];
      for (const g of data.groups || []) {
        const target = g.adbEndpoint || g.ip;
        if (!target || seen.has(target)) continue;
        seen.add(target);
        targets.push({
          target,
          label: g.name && g.name !== g.ip ? g.name : g.deviceType || g.ip,
        });
      }

      targetListEl.replaceChildren();
      for (const t of targets) {
        const opt = document.createElement("option");
        opt.value = t.target;
        opt.label = t.label;
        targetListEl.append(opt);
      }

      chipsEl.replaceChildren();
      for (const t of targets.slice(0, 10)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "fn-chip";
        chip.title = `Usar ${t.target} como alvo`;
        const ip = document.createElement("b");
        ip.textContent = t.target;
        const name = document.createElement("span");
        name.textContent = t.label;
        chip.append(ip, name);
        chip.onclick = () => {
          state.target = t.target;
          localStorage.setItem(LS_TARGET, t.target);
          const input = fieldsEl.querySelector('[data-field="target"]');
          if (input) input.value = t.target;
          setHint(`Alvo definido: ${t.target}`, "ok");
        };
        chipsEl.append(chip);
      }
    } catch {
      /* sem lista de dispositivos; o alvo pode ser digitado */
    }
  }

  buildSelect();
  renderFields();
  loadTargets();
})();
