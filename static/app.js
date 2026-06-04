/* ConjointLab — panel del investigador (vanilla JS SPA) */
const App = (() => {
  let token = localStorage.getItem("cl_token") || null;
  let user = JSON.parse(localStorage.getItem("cl_user") || "null");
  let authMode = "login";
  let editing = null;          // estudio en edición
  let editAttrs = [];          // estado del editor de atributos
  let charts = [];             // instancias Chart.js para destruir al re-render

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) { logout(); throw new Error("Sesión expirada"); }
    if (!res.ok) {
      let msg = "Error";
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (n) => (n * 100).toFixed(1) + "%";

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------- auth ---------- */
  function setAuthMode(m) {
    authMode = m;
    $("tab-login").classList.toggle("on", m === "login");
    $("tab-register").classList.toggle("on", m === "register");
    $("reg-name-wrap").classList.toggle("hidden", m !== "register");
    $("auth-btn").textContent = m === "login" ? "Entrar" : "Crear cuenta";
    $("auth-err").textContent = "";
  }

  async function submitAuth() {
    $("auth-err").textContent = "";
    const email = $("auth-email").value.trim();
    const password = $("auth-pass").value;
    if (!email || !password) { $("auth-err").textContent = "Completa correo y contraseña."; return; }
    try {
      const body = authMode === "register"
        ? { email, password, name: $("reg-name").value.trim() || "Investigador" }
        : { email, password };
      const data = await api("/api/auth/" + authMode, { method: "POST", body: JSON.stringify(body) });
      token = data.token; user = data.user;
      localStorage.setItem("cl_token", token);
      localStorage.setItem("cl_user", JSON.stringify(user));
      enterApp();
    } catch (e) { $("auth-err").textContent = e.message; }
  }

  function logout() {
    token = null; user = null;
    localStorage.removeItem("cl_token"); localStorage.removeItem("cl_user");
    $("view-app").classList.add("hidden"); $("view-login").classList.remove("hidden");
  }

  function enterApp() {
    $("view-login").classList.add("hidden"); $("view-app").classList.remove("hidden");
    $("user-name").textContent = user.name;
    go("dashboard");
  }

  /* ---------- router ---------- */
  function go(screen, arg) {
    ["dashboard", "editor", "results"].forEach((s) =>
      $("screen-" + s).classList.toggle("hidden", s !== screen));
    if (screen === "dashboard") renderDashboard();
    if (screen === "editor") renderEditor(arg);
    if (screen === "results") renderResults(arg);
  }

  /* ---------- dashboard ---------- */
  async function renderDashboard() {
    const el = $("screen-dashboard");
    el.innerHTML = `<div class="page-head"><div><div class="eyebrow">Hola, ${esc(user.name)}</div><h1 class="h">Tus estudios</h1></div>
      <button class="btn primary lg" onclick="App.go('editor')">＋ Nuevo estudio</button></div>
      <div id="dash-list" class="muted">Cargando…</div>`;
    try {
      const studies = await api("/api/studies");
      const totalResp = studies.reduce((n, s) => n + s.response_count, 0);
      const list = $("dash-list");
      if (!studies.length) {
        list.innerHTML = `<div class="empty"><p>Todavía no hay estudios.</p><p>Crea tu primer estudio conjoint para empezar.</p></div>`;
        return;
      }
      list.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="v">${studies.length}</div><div class="l">Estudios</div></div>
          <div class="stat"><div class="v">${totalResp}</div><div class="l">Respuestas totales</div></div>
          <div class="stat"><div class="v">${studies.reduce((n, s) => n + s.attribute_count, 0)}</div><div class="l">Atributos definidos</div></div>
          <div class="stat"><div class="v">${studies.reduce((n, s) => n + s.category_count, 0)}</div><div class="l">Categorías</div></div>
        </div>
        <div class="studies">${studies.map(studyCard).join("")}</div>`;
    } catch (e) { $("dash-list").innerHTML = `<p class="err">${e.message}</p>`; }
  }

  function studyCard(s) {
    const progress = Math.min(100, (s.response_count / Math.max(1, s.num_respondents)) * 100);
    return `<div class="study">
      <h3>${esc(s.name)}</h3>
      <div class="meta"><span>◧ ${s.attribute_count} atributos</span><span>⬚ ${s.category_count} categorías</span><span>▤ ${s.tasks_per_respondent}×${s.options_per_task}</span></div>
      <div class="bar-mini"><div style="width:${progress}%"></div></div>
      <div class="muted mono" style="font-size:11.5px">${s.response_count} / ${s.num_respondents} respuestas</div>
      <div class="acts">
        <button class="btn primary sm" onclick="App.go('results','${s.id}')">📊 Resultados</button>
        <button class="btn soft sm" onclick="App.copyLink('${s.public_token}')">🔗 Link</button>
        <button class="btn ghost sm" onclick="App.go('editor','${s.id}')">✎ Editar</button>
        <button class="btn ghost sm" onclick="App.del('${s.id}','${esc(s.name)}')">🗑</button>
      </div></div>`;
  }

  function opLink(token) {
    const name = (document.getElementById("op-name").value || "").trim();
    if (!name) { toast("Escribe el nombre del operador"); return; }
    const url = `${location.origin}/survey?study=${token}&op=${encodeURIComponent(name)}`;
    navigator.clipboard?.writeText(url);
    document.getElementById("op-link-out").innerHTML =
      `<div class="share-link">${esc(url)}<button class="btn soft sm" onclick="navigator.clipboard&&navigator.clipboard.writeText('${url.replace(/'/g, "\\'")}')">Copiar</button></div>`;
    toast("Link de " + name + " copiado");
  }

  function copyLink(token) {
    const url = `${location.origin}/survey?study=${token}`;
    navigator.clipboard?.writeText(url);
    toast("Link de encuesta copiado");
  }

  async function del(id, name) {
    if (!confirm(`¿Eliminar "${name}" y todas sus respuestas?`)) return;
    await api("/api/studies/" + id, { method: "DELETE" });
    toast("Estudio eliminado"); renderDashboard();
  }

  /* ---------- editor ---------- */
  async function renderEditor(id) {
    editing = null;
    if (id) editing = await api("/api/studies/" + id);
    editAttrs = editing
      ? editing.attributes.map((a) => ({ name: a.name, categories: a.categories.map((c) => c.name) }))
      : [
          { name: "Precio", categories: ["$100", "$150", "$200"] },
          { name: "Marca", categories: ["Marca A", "Marca B", "Marca C"] },
        ];
    const el = $("screen-editor");
    el.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">${editing ? "Editar" : "Nuevo"} estudio</div><h1 class="h">Configuración</h1></div>
        <button class="btn ghost" onclick="App.go('dashboard')">‹ Volver</button></div>
      <div class="card">
        <div class="grid2">
          <div><label class="label">Nombre del estudio</label><input id="f-name" value="${esc(editing?.name || "")}" placeholder="Ej. Preferencia de producto 2026" /></div>
          <div class="grid3">
            <div><label class="label">Entrevistados</label><input id="f-resp" type="number" class="mono" value="${editing?.num_respondents || 50}" /></div>
            <div><label class="label">Tareas/persona</label><input id="f-tasks" type="number" class="mono" value="${editing?.tasks_per_respondent || 8}" /></div>
            <div><label class="label">Opciones/tarea</label><input id="f-opts" type="number" class="mono" value="${editing?.options_per_task || 3}" /></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><div class="card-title">◧ Atributos y categorías</div>
          <button class="btn soft sm" onclick="App.addAttr()">＋ Atributo</button></div>
        <div id="attr-list"></div>
      </div>
      <div class="row" style="justify-content:space-between; padding:6px 2px">
        <div class="muted" id="combo-info"></div>
        <button class="btn primary lg" onclick="App.saveStudy()">✓ Guardar estudio</button>
      </div>`;
    renderAttrs();
  }

  function renderAttrs() {
    const possible = editAttrs.reduce((p, a) => p * Math.max(a.categories.filter((c) => c.trim()).length, 1), 1);
    $("combo-info").textContent = `${possible.toLocaleString()} combinaciones posibles`;
    $("attr-list").innerHTML = editAttrs.map((a, ai) => `
      <div class="attr">
        <div class="attr-head"><span class="attr-no">${ai + 1}</span>
          <input value="${esc(a.name)}" placeholder="Nombre del atributo" oninput="App.setAttrName(${ai}, this.value)" />
          <button class="icon-btn" onclick="App.delAttr(${ai})">🗑</button></div>
        <div class="cats">
          ${a.categories.map((c, ci) => `<span class="cat"><input value="${esc(c)}" placeholder="Categoría" oninput="App.setCat(${ai},${ci},this.value)" /><button class="x" onclick="App.delCat(${ai},${ci})">×</button></span>`).join("")}
          <button class="cat-add" onclick="App.addCat(${ai})">＋ categoría</button>
        </div></div>`).join("");
  }
  const addAttr = () => { editAttrs.push({ name: "", categories: [""] }); renderAttrs(); };
  const delAttr = (i) => { editAttrs.splice(i, 1); renderAttrs(); };
  const setAttrName = (i, v) => { editAttrs[i].name = v; };
  const addCat = (i) => { editAttrs[i].categories.push(""); renderAttrs(); };
  const delCat = (i, c) => { editAttrs[i].categories.splice(c, 1); renderAttrs(); };
  const setCat = (i, c, v) => { editAttrs[i].categories[c] = v; document.getElementById("combo-info").textContent =
    editAttrs.reduce((p, a) => p * Math.max(a.categories.filter((x) => x.trim()).length, 1), 1).toLocaleString() + " combinaciones posibles"; };

  async function saveStudy() {
    const attributes = editAttrs
      .map((a) => ({ name: a.name.trim(), categories: a.categories.filter((c) => c.trim()).map((c) => ({ name: c.trim() })) }))
      .filter((a) => a.name && a.categories.length >= 2);
    if (!$("f-name").value.trim()) return toast("Ponle nombre al estudio");
    if (attributes.length < 2) return toast("Necesitas ≥2 atributos con ≥2 categorías");
    const body = {
      name: $("f-name").value.trim(),
      num_respondents: +$("f-resp").value || 50,
      tasks_per_respondent: +$("f-tasks").value || 8,
      options_per_task: +$("f-opts").value || 3,
      attributes,
    };
    try {
      if (editing) await api("/api/studies/" + editing.id, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/studies", { method: "POST", body: JSON.stringify(body) });
      toast("Estudio guardado"); go("dashboard");
    } catch (e) { toast(e.message); }
  }

  /* ---------- results / dashboards ---------- */
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  async function renderResults(id) {
    destroyCharts();
    const el = $("screen-results");
    el.innerHTML = `<div class="muted">Cargando resultados…</div>`;
    let R, study;
    try {
      study = await api("/api/studies/" + id);
      R = await api("/api/studies/" + id + "/results");
    } catch (e) { el.innerHTML = `<p class="err">${e.message}</p>`; return; }

    const head = `<div class="page-head"><div><div class="eyebrow">${esc(study.name)}</div><h1 class="h">Panel de resultados</h1></div>
      <div class="row">
        <button class="btn soft" onclick="App.download('${id}','csv')">⬇ CSV</button>
        <button class="btn primary" onclick="App.download('${id}','xlsx')">⬇ Excel</button>
        <button class="btn ghost" onclick="App.go('dashboard')">‹ Volver</button>
      </div></div>`;

    if (R.total_choices === 0) {
      el.innerHTML = head + `<div class="empty"><p>Aún no hay respuestas para este estudio.</p>
        <p>Comparte el link de la encuesta para empezar a recopilar.</p>
        <div class="share-link" style="max-width:520px;margin:14px auto;">${location.origin}/survey?study=${study.public_token}
        <button class="btn soft sm" onclick="App.copyLink('${study.public_token}')">Copiar</button></div></div>`;
      return;
    }

    el.innerHTML = head + `
      <div class="stats">
        <div class="stat"><div class="v">${R.n_responses}</div><div class="l">Encuestados</div></div>
        <div class="stat"><div class="v">${R.total_choices}</div><div class="l">Elecciones</div></div>
        <div class="stat"><div class="v">${R.attribute_count}</div><div class="l">Atributos</div></div>
        <div class="stat"><div class="v">${R.combos.length}</div><div class="l">Combinaciones vistas</div></div>
      </div>
      <div class="card">
        <div class="card-title">🧑‍💼 Operadores de campo</div>
        <p class="muted" style="font-size:12.5px">Genera un link por operador. Todas las respuestas caen en este mismo estudio, pero podrás saber quién capturó cada una.</p>
        <div class="row" style="margin:10px 0">
          <input id="op-name" placeholder="Nombre del operador (ej. Juan)" style="max-width:260px" />
          <button class="btn soft" onclick="App.opLink('${study.public_token}')">Generar link</button>
        </div>
        <div id="op-link-out"></div>
        ${(R.by_operator && R.by_operator.length) ? `
        <table style="margin-top:8px"><thead><tr><th>Operador</th><th>Entrevistas</th><th>Elecciones</th></tr></thead>
        <tbody>${R.by_operator.map((o) => `<tr><td>${esc(o.operator)}</td><td class="mono">${o.respondents}</td><td class="mono">${o.choices}</td></tr>`).join("")}</tbody></table>` : ""}
      </div>
      <div class="card">
        <div class="card-title">📊 Elección por atributo y categoría</div>
        <p class="muted" style="font-size:12.5px">El <b>%</b> suma 100% dentro de cada atributo. La <b>tasa</b> = elegida ÷ mostrada (ajustada por exposición).</p>
        <div class="chart-grid" id="attr-charts"></div>
      </div>
      <div class="card">
        <div class="card-title">🏆 Ranking de categorías más fuertes</div>
        <div id="rank">${R.all_categories.slice(0, 12).map((c, i) => rankRow(c, i, R.all_categories[0].win_rate || 1)).join("")}</div>
      </div>
      <div class="card">
        <div class="card-title">📈 Combinaciones óptimas</div>
        <div class="chart-box" style="margin-bottom:14px"><div class="chart-canvas" style="height:${Math.max(170, Math.min(8, R.combos.length) * 46)}px"><canvas id="combo-chart"></canvas></div></div>
        <table><thead><tr><th>#</th><th>Combinación</th><th>Mostr.</th><th>Eleg.</th><th>% total</th><th>Tasa</th></tr></thead>
        <tbody>${R.combos.slice(0, 15).map((c, i) => `<tr class="${i === 0 ? "lead" : ""}"><td class="mono">${i + 1}</td>
          <td>${c.parts.map((p) => `<span class="chip">${esc(p.category_name)}</span>`).join("")}</td>
          <td class="mono">${c.shown}</td><td class="mono">${c.chosen}</td><td class="mono">${pct(c.share)}</td><td class="mono">${pct(c.win_rate)}</td></tr>`).join("")}</tbody></table>
      </div>`;

    // 1) Crea TODOS los recuadros primero (para que la grilla ya tenga sus
    //    columnas finales). 2) Recién entonces dibuja, con el ancho correcto.
    const wrap = $("attr-charts");
    if (wrap) {
      const specs = R.by_attribute.map((a) => ({
        name: a.attribute_name,
        labels: a.categories.map((c) => c.category_name),
        data: a.categories.map((c) => +(c.share * 100).toFixed(1)),
        height: Math.max(150, a.categories.length * 46),
      }));
      wrap.innerHTML = specs.map((s, i) =>
        `<div class="chart-box"><h4>${esc(s.name)}</h4><div class="chart-canvas" style="height:${s.height}px"><canvas data-ci="${i}"></canvas></div></div>`
      ).join("");
      requestAnimationFrame(() => {
        specs.forEach((s, i) => {
          const cv = wrap.querySelector(`canvas[data-ci="${i}"]`);
          if (cv) charts.push(barChart(cv, s.labels, s.data, "#C8553D", s.height));
        });
        const top = R.combos.slice(0, 8);
        charts.push(barChart($("combo-chart"),
          top.map((c) => c.label.length > 26 ? c.label.slice(0, 24) + "…" : c.label),
          top.map((c) => +(c.share * 100).toFixed(1)), "#2E6B68", Math.max(170, Math.min(8, R.combos.length) * 46)));
      });
    }
  }

  function rankRow(c, i, max) {
    return `<div class="rank-row"><span class="rank-no mono">${i + 1}</span>
      <span class="rank-tag">${esc(c.attribute_name)}</span>
      <span class="rank-name">${esc(c.category_name)}</span>
      <div class="rank-bar"><div style="width:${(c.win_rate / max) * 100}%"></div></div>
      <span class="mono" style="width:54px;text-align:right">${pct(c.win_rate)}</span></div>`;
  }

  function barChart(canvas, labels, data, color, fixedHeight) {
    // Tamaño FIJO en píxeles. La altura es un número fijo (no se lee del
    // layout, así nunca puede crecer); el ancho se toma del recuadro.
    const box = canvas.parentElement;
    const w = Math.max(200, Math.floor(box.clientWidth) || 300);
    const h = fixedHeight || 150;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.maxHeight = h + "px";
    return new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: data.map((_, i) => i === 0 ? color : color + "99"), borderRadius: 5, barThickness: 22, maxBarThickness: 28 }] },
      options: {
        indexAxis: "y", responsive: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x + "%" } } },
        scales: {
          x: { beginAtZero: true, ticks: { callback: (v) => v + "%", font: { family: "IBM Plex Mono" } }, grid: { color: "#EDE5D6" } },
          y: { ticks: { font: { family: "Archivo", size: 12 } }, grid: { display: false } },
        },
      },
    });
  }

  async function download(id, fmt) {
    try {
      const res = await api(`/api/studies/${id}/export.${fmt}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `resultados.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast(e.message); }
  }

  /* ---------- init ---------- */
  function init() {
    if (token && user) enterApp();
    $("auth-pass")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });
  }
  document.addEventListener("DOMContentLoaded", init);

  return { setAuthMode, submitAuth, logout, go, del, copyLink, opLink, download,
    addAttr, delAttr, setAttrName, addCat, delCat, setCat, saveStudy };
})();
