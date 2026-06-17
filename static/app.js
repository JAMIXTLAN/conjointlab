/* ConjointLab — panel del investigador (vanilla JS SPA) */
const App = (() => {
  let token = localStorage.getItem("cl_token") || null;
  let user = JSON.parse(localStorage.getItem("cl_user") || "null");
  let authMode = "login";
  let editing = null;          // estudio en edición
  let editAttrs = [];          // estado del editor de atributos
  let editProfile = [];        // estado del editor de campos de perfil
  let editQuestions = [];      // estado del editor de preguntas estándar
  let editHasConjoint = true;  // si el estudio incluye bloque conjoint
  let charts = [];             // instancias Chart.js para destruir al re-render

  // Configuración por defecto de los campos de perfil (espejo del backend).
  const DEFAULT_PROFILE_FIELDS = [
    { key: "sex", label: "Sexo", type: "single", enabled: true, required: true,
      options: ["Hombre", "Mujer", "Otro", "Prefiere no decir"] },
    { key: "age_group", label: "Edad", type: "single", enabled: true, required: true,
      options: ["Menos de 18", "18 a 35", "36 a 50", "51 a 60", "61 y más"] },
    { key: "occupation", label: "Ocupación", type: "single", enabled: true, required: false,
      options: ["Ama de casa", "Estudiante", "Empleado/a del sector privado", "Empleado/a de gobierno",
        "Comerciante", "Empresario/a", "Trabajador/a independiente", "Profesionista independiente",
        "Campesino/a o trabajador/a del campo", "Obrero/a", "Jubilado/a o pensionado/a",
        "Desempleado/a", "Otra", "Prefiere no decir"] },
    { key: "education", label: "Escolaridad", type: "single", enabled: true, required: false,
      options: ["Sin estudios", "Primaria", "Secundaria", "Preparatoria / bachillerato",
        "Carrera técnica", "Licenciatura", "Posgrado", "Prefiere no decir"] },
    { key: "municipality", label: "Municipio", type: "text", enabled: true, required: true, options: [] },
    { key: "district", label: "Distrito", type: "text", enabled: true, required: false, options: [],
      help: "Distrito local, federal o clave interna del estudio." },
    { key: "electoral_section", label: "Sección electoral", type: "number_flex", enabled: true, required: false, options: [],
      help: "Preferentemente numérica; admite clave especial." },
    { key: "locality_zone", label: "Localidad / colonia / zona", type: "text", enabled: true, required: false, options: [] },
  ];

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
    const srcFields = (editing && editing.profile_config && editing.profile_config.fields)
      ? editing.profile_config.fields : DEFAULT_PROFILE_FIELDS;
    editProfile = JSON.parse(JSON.stringify(srcFields));  // copia profunda
    editQuestions = editing && editing.questions ? JSON.parse(JSON.stringify(editing.questions)) : [];
    editHasConjoint = editing ? !!editing.has_conjoint : true;
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
        <label class="row" style="gap:10px;cursor:pointer;align-items:center">
          <input type="checkbox" id="f-conjoint" ${editHasConjoint ? "checked" : ""} onchange="App.toggleConjoint(this.checked)">
          <span><b>Incluir bloque de análisis conjoint</b><br><span class="muted" style="font-size:12.5px">Desactívalo si quieres un estudio solo de cuestionario.</span></span>
        </label>
      </div>
      <div class="card" id="conjoint-card">
        <div class="row" style="justify-content:space-between"><div class="card-title">◧ Atributos y categorías</div>
          <button class="btn soft sm" onclick="App.addAttr()">＋ Atributo</button></div>
        <div id="attr-list"></div>
        <div class="muted" id="combo-info" style="margin-top:8px"></div>
      </div>
      <div class="card">
        <div class="card-title">👤 Perfil del entrevistado</div>
        <p class="muted" style="margin:2px 0 10px">Define qué se captura antes de las tareas. Marca obligatorios y edita las opciones de los menús cerrados (una por línea).</p>
        <div id="profile-list"></div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><div class="card-title">📝 Cuestionario</div>
          <div class="row" style="gap:6px">
            <button class="btn soft sm" onclick="App.addQuestion('single')">＋ Pregunta</button>
          </div></div>
        <p class="muted" style="margin:2px 0 10px">Preguntas estándar. Usa la sección para ubicarlas antes o después del conjoint.</p>
        <div id="question-list"></div>
      </div>
      <div class="row" style="justify-content:flex-end; padding:6px 2px">
        <button class="btn primary lg" onclick="App.saveStudy()">✓ Guardar estudio</button>
      </div>`;
    renderAttrs();
    renderProfile();
    renderQuestions();
    applyConjointVisibility();
  }

  function applyConjointVisibility() {
    const card = $("conjoint-card");
    if (card) card.style.display = editHasConjoint ? "" : "none";
  }
  const toggleConjoint = (v) => { editHasConjoint = v; applyConjointVisibility(); };

  const QTYPES = { open: "Abierta", single: "Opción única", multi: "Opción múltiple", likert: "Escala Likert", numeric: "Numérica" };

  function renderQuestions() {
    const host = $("question-list");
    if (!editQuestions.length) {
      host.innerHTML = `<p class="muted" style="font-size:13px">Aún no hay preguntas. Agrega una con el botón de arriba.</p>`;
      return;
    }
    host.innerHTML = editQuestions.map((q, i) => {
      const isClosed = q.qtype === "single" || q.qtype === "multi" || q.qtype === "likert";
      const cfg = q.config || {};
      let extra = "";
      if (isClosed) {
        const opts = cfg.options || [];
        const rows = opts.map((o, j) => {
          const img = o.image || "";
          const thumb = img ? `<img src="${esc(img)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line)" onerror="this.style.opacity=.25">` : `<div style="width:34px;height:34px;border-radius:6px;border:1px dashed var(--line)"></div>`;
          return `<div class="qopt">
            ${thumb}
            <input value="${esc(o.text != null ? o.text : o)}" placeholder="Texto de la opción" style="flex:1" oninput="App.setQOptField(${i},${j},'text',this.value)">
            <input value="${esc(img)}" placeholder="URL de imagen (opcional)" style="flex:1.2" oninput="App.setQOptField(${i},${j},'image',this.value)">
            <label class="row" style="gap:4px;font-size:11px;cursor:pointer" title="Fijar al final (no se aleatoriza)"><input type="checkbox" ${o.anchor ? "checked" : ""} onchange="App.setQOptField(${i},${j},'anchor',this.checked)"> ancla</label>
            <button class="x" onclick="App.delQOpt(${i},${j})">×</button>
          </div>`;
        }).join("");
        extra = `<div style="margin-top:8px">
          <label class="label" style="font-size:11px">Opciones (texto y, si quieres, una imagen por opción: logo de partido, foto de candidato…)</label>
          <div>${rows}</div>
          <button class="cat-add" onclick="App.addQOpt(${i})">＋ opción</button>
          <label class="row" style="gap:6px;font-size:12.5px;cursor:pointer;margin-top:8px"><input type="checkbox" ${q.randomize?"checked":""} onchange="App.setQ(${i},'randomize',this.checked)"> Aleatorizar opciones</label>
        </div>`;
      } else if (q.qtype === "numeric") {
        extra = `<div class="row" style="gap:10px;margin-top:8px">
          <div><label class="label" style="font-size:11px">Mínimo</label><input type="number" class="mono" style="max-width:90px" value="${cfg.min!=null?cfg.min:0}" oninput="App.setQNum(${i},'min',this.value)"></div>
          <div><label class="label" style="font-size:11px">Máximo</label><input type="number" class="mono" style="max-width:90px" value="${cfg.max!=null?cfg.max:10}" oninput="App.setQNum(${i},'max',this.value)"></div>
        </div>`;
      } else {
        extra = `<p class="muted" style="font-size:11.5px;margin-top:6px">Respuesta de texto (el audio se añadirá en una fase posterior).</p>`;
      }
      return `<div class="qrow">
        <div class="qhead">
          <span class="qtag">${i + 1} · ${QTYPES[q.qtype] || q.qtype}</span>
          <div class="row" style="gap:8px">
            <select onchange="App.setQ(${i},'qtype',this.value)" style="font-size:12.5px;padding:4px 8px">
              ${Object.entries(QTYPES).map(([k, v]) => `<option value="${k}" ${q.qtype === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
            <select onchange="App.setQ(${i},'section',this.value)" style="font-size:12.5px;padding:4px 8px">
              <option value="pre" ${q.section === "pre" ? "selected" : ""}>Antes del conjoint</option>
              <option value="post" ${q.section === "post" ? "selected" : ""}>Después del conjoint</option>
            </select>
            <button class="icon-btn" onclick="App.moveQuestion(${i},-1)" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="icon-btn" onclick="App.moveQuestion(${i},1)" ${i === editQuestions.length - 1 ? "disabled" : ""}>↓</button>
            <button class="icon-btn" onclick="App.delQuestion(${i})">🗑</button>
          </div>
        </div>
        <input value="${esc(q.text || "")}" placeholder="Escribe la pregunta…" style="margin-top:10px" oninput="App.setQ(${i},'text',this.value)">
        ${extra}
        <label class="row" style="gap:6px;font-size:12.5px;cursor:pointer;margin-top:8px"><input type="checkbox" ${q.required?"checked":""} onchange="App.setQ(${i},'required',this.checked)"> Obligatoria</label>
      </div>`;
    }).join("");
  }

  const addQuestion = (qtype) => {
    editQuestions.push({ qtype: qtype || "single", section: "pre", text: "", required: false, randomize: false,
      config: (qtype === "numeric") ? { min: 0, max: 10 } : { options: [] }, position: editQuestions.length });
    renderQuestions();
  };
  const delQuestion = (i) => { editQuestions.splice(i, 1); renderQuestions(); };
  const moveQuestion = (i, d) => {
    const j = i + d; if (j < 0 || j >= editQuestions.length) return;
    const t = editQuestions[i]; editQuestions[i] = editQuestions[j]; editQuestions[j] = t; renderQuestions();
  };
  const setQ = (i, key, val) => {
    editQuestions[i][key] = val;
    if (key === "qtype") {
      // ajusta config por defecto al cambiar de tipo
      if (val === "numeric") editQuestions[i].config = { min: 0, max: 10 };
      else if (val === "open") editQuestions[i].config = {};
      else if (!editQuestions[i].config || !editQuestions[i].config.options) editQuestions[i].config = { options: [] };
      renderQuestions();
    }
  };
  const _ensureOpts = (i) => {
    if (!editQuestions[i].config) editQuestions[i].config = {};
    if (!Array.isArray(editQuestions[i].config.options)) editQuestions[i].config.options = [];
    return editQuestions[i].config.options;
  };
  const addQOpt = (i) => {
    const opts = _ensureOpts(i);
    opts.push({ id: Math.random().toString(36).slice(2, 8), text: "", image: "", anchor: false });
    renderQuestions();
  };
  const delQOpt = (i, j) => { _ensureOpts(i).splice(j, 1); renderQuestions(); };
  const setQOptField = (i, j, field, val) => {
    const opts = _ensureOpts(i);
    if (!opts[j]) return;
    if (typeof opts[j] !== "object") opts[j] = { id: Math.random().toString(36).slice(2, 8), text: String(opts[j]) };
    opts[j][field] = val;
    // re-render solo al cambiar 'ancla' (para no perder el foco al escribir)
    if (field === "anchor") renderQuestions();
  };
  const setQNum = (i, key, val) => {
    editQuestions[i].config = Object.assign({}, editQuestions[i].config, { [key]: val === "" ? null : +val });
  };

  function renderProfile() {
    $("profile-list").innerHTML = editProfile.map((f, i) => {
      const isClosed = f.type === "single";
      const optsBox = isClosed
        ? `<div style="margin-top:8px"><label class="label" style="font-size:11px">Opciones (una por línea)</label>
             <textarea rows="${Math.min((f.options||[]).length+1,8)}" style="width:100%;font-family:inherit;font-size:13px"
               oninput="App.setPFOptions(${i}, this.value)">${esc((f.options||[]).join("\n"))}</textarea></div>`
        : `<div class="muted" style="font-size:11px;margin-top:6px">Campo abierto${f.help ? " — " + esc(f.help) : ""}</div>`;
      return `<div class="attr" style="padding:12px 14px">
        <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-weight:600">${esc(f.label)} <span class="muted" style="font-weight:400;font-size:11px">(${isClosed ? "menú cerrado" : "texto"})</span></div>
          <div class="row" style="gap:16px">
            <label class="row" style="gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" ${f.enabled!==false?"checked":""} onchange="App.setPF(${i},'enabled',this.checked)"> Incluir</label>
            <label class="row" style="gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" ${f.required?"checked":""} onchange="App.setPF(${i},'required',this.checked)"> Obligatorio</label>
          </div>
        </div>
        ${optsBox}
      </div>`;
    }).join("");
  }
  const setPF = (i, key, val) => { editProfile[i][key] = val; };
  const setPFOptions = (i, text) => {
    editProfile[i].options = text.split("\n").map((s) => s.trim()).filter(Boolean);
  };

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
    const questions = editQuestions
      .filter((q) => (q.text || "").trim())
      .map((q, i) => ({
        position: i, section: q.section || "pre", qtype: q.qtype || "single",
        text: q.text.trim(), required: !!q.required, randomize: !!q.randomize,
        config: q.config || {},
      }));
    if (editHasConjoint && attributes.length < 2) return toast("El conjoint necesita ≥2 atributos con ≥2 categorías");
    if (!editHasConjoint && questions.length === 0) return toast("Agrega al menos una pregunta o activa el conjoint");
    const body = {
      name: $("f-name").value.trim(),
      num_respondents: +$("f-resp").value || 50,
      tasks_per_respondent: +$("f-tasks").value || 8,
      options_per_task: +$("f-opts").value || 3,
      attributes,
      has_conjoint: editHasConjoint,
      profile_config: { fields: editProfile },
      questions,
    };
    try {
      if (editing) await api("/api/studies/" + editing.id, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/studies", { method: "POST", body: JSON.stringify(body) });
      toast("Estudio guardado"); go("dashboard");
    } catch (e) { toast(e.message); }
  }

  /* ---------- results / dashboards ---------- */
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  let curId = null, curStudy = null, curSeg = { field: "", value: "" };

  async function renderResults(id) {
    destroyCharts();
    curId = id; curSeg = { field: "", value: "" };
    const el = $("screen-results");
    el.innerHTML = `<div class="muted">Cargando resultados…</div>`;
    try {
      curStudy = await api("/api/studies/" + id);
    } catch (e) { el.innerHTML = `<p class="err">${e.message}</p>`; return; }
    loadResults();
  }

  const segField = (f) => { curSeg.field = f; curSeg.value = ""; loadResults(); };
  const segValue = (v) => { curSeg.value = v; loadResults(); };
  const segClear = () => { curSeg = { field: "", value: "" }; loadResults(); };

  function segBar(R) {
    const segs = R.segments || [];
    if (!segs.length) return "";
    const fieldOpts = `<option value="">— Todos los entrevistados —</option>` +
      segs.map((s) => `<option value="${s.field}" ${curSeg.field === s.field ? "selected" : ""}>${esc(s.label)}</option>`).join("");
    let valueSel = `<select id="seg-value" disabled><option>—</option></select>`;
    if (curSeg.field) {
      const cur = segs.find((s) => s.field === curSeg.field);
      if (cur) {
        const opts = `<option value="">— Elige un valor —</option>` +
          cur.values.map((v) => `<option value="${esc(v.value)}" ${curSeg.value === v.value ? "selected" : ""}>${esc(v.value)} (${v.n})</option>`).join("");
        valueSel = `<select id="seg-value" onchange="App.segValue(this.value)">${opts}</select>`;
      }
    }
    const banner = R.applied_filter
      ? `<div class="chip" style="margin-top:10px;background:#FCEFE9;color:#C8553D">
           Mostrando: <b>&nbsp;${esc(R.applied_filter.label)} = ${esc(R.applied_filter.value)}</b> &nbsp;(n=${R.n_responses})
           <button class="x" onclick="App.segClear()" title="Quitar filtro">×</button></div>`
      : `<div class="muted" style="font-size:12px;margin-top:8px">Sin filtro: mostrando todos los entrevistados.</div>`;
    return `<div class="card">
      <div class="card-title">🔎 Segmentación</div>
      <p class="muted" style="font-size:12.5px">Cruza los resultados por perfil o territorio. Por ejemplo: qué precandidato funciona mejor entre mujeres, o qué combinación gana en cierto municipio.</p>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:8px">
        <select id="seg-field" onchange="App.segField(this.value)" style="max-width:260px">${fieldOpts}</select>
        ${valueSel}
      </div>
      ${banner}
    </div>`;
  }

  async function loadResults() {
    destroyCharts();
    const id = curId, study = curStudy;
    const el = $("screen-results");
    let R;
    let qs = "";
    if (curSeg.field && curSeg.value) qs = `?seg_field=${encodeURIComponent(curSeg.field)}&seg_value=${encodeURIComponent(curSeg.value)}`;
    try {
      R = await api("/api/studies/" + id + "/results" + qs);
    } catch (e) { el.innerHTML = `<p class="err">${e.message}</p>`; return; }

    const head = `<div class="page-head"><div><div class="eyebrow">${esc(study.name)}</div><h1 class="h">Panel de resultados</h1></div>
      <div class="row">
        <button class="btn soft" onclick="App.download('${id}','csv')">⬇ CSV</button>
        <button class="btn primary" onclick="App.download('${id}','xlsx')">⬇ Excel</button>
        <button class="btn ghost" onclick="App.go('dashboard')">‹ Volver</button>
      </div></div>`;

    const anyResponses = (R.n_respondents || 0) > 0 || (R.total_choices || 0) > 0;

    if (!anyResponses) {
      if (R.applied_filter) {
        el.innerHTML = head + segBar(R) + `<div class="empty"><p>No hay respuestas para este segmento.</p>
          <p>Prueba con otro valor o quita el filtro.</p></div>`;
      } else {
        el.innerHTML = head + `<div class="empty"><p>Aún no hay respuestas para este estudio.</p>
          <p>Comparte el link de la encuesta para empezar a recopilar.</p>
          <div class="share-link" style="max-width:520px;margin:14px auto;">${location.origin}/survey?study=${study.public_token}
          <button class="btn soft sm" onclick="App.copyLink('${study.public_token}')">Copiar</button></div></div>`;
      }
      return;
    }

    const showConjoint = R.has_conjoint && (R.total_choices || 0) > 0;
    const statsHTML = `<div class="stats">
        <div class="stat"><div class="v">${R.n_respondents}</div><div class="l">Encuestados</div></div>
        ${showConjoint ? `
        <div class="stat"><div class="v">${R.total_choices}</div><div class="l">Elecciones</div></div>
        <div class="stat"><div class="v">${R.attribute_count}</div><div class="l">Atributos</div></div>
        <div class="stat"><div class="v">${R.combos.length}</div><div class="l">Combinaciones vistas</div></div>` : ""}
      </div>`;

    const operatorsHTML = R.applied_filter ? "" : `<div class="card">
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
      </div>`;

    const conjointHTML = showConjoint ? `
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
      </div>` : "";

    el.innerHTML = head + segBar(R) + statsHTML + operatorsHTML + conjointHTML + questionsHTML(R);

    if (showConjoint) {
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
  }

  function bar(pctFrac, color) {
    const w = Math.max(0, Math.min(100, Math.round((pctFrac || 0) * 100)));
    return `<div style="height:8px;background:#ECEAE5;border-radius:5px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${w}%;background:${color || "#2E6B68"}"></div></div>`;
  }

  function questionsHTML(R) {
    const qrs = R.question_results || [];
    if (!qrs.length) return "";
    const blocks = qrs.map((q) => {
      let inner = "";
      if (q.qtype === "open") {
        const resp = q.responses || [];
        inner = `<p class="muted" style="font-size:12.5px">${resp.length} respuesta(s) de texto.</p>
          <div style="max-height:260px;overflow:auto;margin-top:6px">
          ${resp.slice(0, 50).map((t) => `<div style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;font-size:13.5px">${esc(t)}</div>`).join("") || '<p class="muted">Sin respuestas.</p>'}
          </div>`;
      } else if (q.qtype === "numeric") {
        const dist = q.dist || [];
        const maxc = Math.max(1, ...dist.map((d) => d.count));
        inner = `<div class="row" style="gap:24px;align-items:baseline;flex-wrap:wrap">
            <div><span style="font-family:'Fraunces',serif;font-size:34px">${q.mean != null ? q.mean.toFixed(2) : "—"}</span> <span class="muted">promedio</span></div>
            <div class="muted" style="font-size:13px">mín ${q.min ?? "—"} · máx ${q.max ?? "—"} · n=${q.count || 0}</div>
          </div>
          <div style="margin-top:10px">${dist.map((d) => `<div class="row" style="gap:10px;align-items:center;margin:3px 0">
            <span class="mono" style="width:28px;text-align:right">${d.value}</span>
            <div style="flex:1">${bar(d.count / maxc, "#2E6B68")}</div>
            <span class="mono muted" style="width:34px">${d.count}</span></div>`).join("")}</div>`;
      } else {
        const opts = q.options || [];
        inner = opts.map((o) => `<div style="margin:8px 0">
            <div class="row" style="justify-content:space-between;font-size:13.5px">
              <span class="row" style="gap:8px;align-items:center">${o.image ? `<img src="${esc(o.image)}" alt="" style="width:26px;height:26px;object-fit:contain;border-radius:5px" onerror="this.style.display='none'">` : ""}${esc(o.text)}</span>
              <span class="mono muted">${o.count} · ${pct(o.pct)}</span></div>
            ${bar(o.pct, "#C8553D")}</div>`).join("");
        if (q.multi) inner += `<p class="muted" style="font-size:11.5px;margin-top:4px">Opción múltiple: los % pueden sumar más de 100%.</p>`;
      }
      const tag = { open: "Abierta", single: "Opción única", multi: "Opción múltiple", likert: "Likert", numeric: "Numérica" }[q.qtype] || q.qtype;
      return `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:baseline">
          <div class="card-title" style="margin:0">${esc(q.text)}</div>
          <span class="qtag">${tag} · ${q.section === "post" ? "post" : "pre"} · n=${q.n}</span>
        </div>
        <div style="margin-top:10px">${inner}</div>
      </div>`;
    }).join("");
    return `<div class="card" style="background:transparent;border:none;box-shadow:none;padding:6px 2px">
        <div class="card-title">📝 Cuestionario</div></div>` + blocks;
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
    addAttr, delAttr, setAttrName, addCat, delCat, setCat, saveStudy,
    setPF, setPFOptions, segField, segValue, segClear,
    toggleConjoint, addQuestion, delQuestion, moveQuestion, setQ, setQNum,
    addQOpt, delQOpt, setQOptField };
})();
