/* ConjointLab — encuesta pública (perfil + preguntas + conjoint) */
(() => {
  const root = document.getElementById("survey-root");
  const params = new URLSearchParams(location.search);
  const token = params.get("study");
  const operator = params.get("op") || "";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  let data = null;
  let stages = [];
  let si = 0;
  let step = 0;
  let demo = {};
  let qans = {};
  let answers = {};

  function toast(m) { const t = document.getElementById("toast"); if (!t) return; t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }

  async function load() {
    if (!token) { root.innerHTML = `<div class="empty"><p>Falta el identificador de la encuesta.</p></div>`; return; }
    try {
      const res = await fetch(`/api/survey/${token}/start`);
      if (!res.ok) throw new Error("Encuesta no encontrada");
      data = await res.json();
      buildStages();
      si = 0; step = 0; demo = {}; qans = {}; answers = {};
      render();
    } catch (e) { root.innerHTML = `<div class="empty"><p class="err">${e.message}</p></div>`; }
  }

  function buildStages() {
    stages = [];
    const fields = ((data.profile_config && data.profile_config.fields) || []).filter(f => f.enabled !== false);
    if (fields.length) stages.push({ type: "profile", fields });
    const qs = data.questions || [];
    qs.filter(q => q.section === "pre").forEach(q => stages.push({ type: "question", q }));
    if (data.has_conjoint && data.tasks && data.tasks.length) stages.push({ type: "conjoint" });
    qs.filter(q => q.section === "post").forEach(q => stages.push({ type: "question", q }));
  }

  function progressPct() { return Math.round((si / Math.max(1, stages.length)) * 100); }
  function header() {
    return `<div class="eyebrow">${esc(data.study_name)}</div>
      <div class="progress"><div class="track"><div style="width:${progressPct()}%"></div></div>
      <span class="mono muted">${si + 1} / ${stages.length}</span></div>`;
  }

  function render() {
    if (si >= stages.length) return renderDone();
    const st = stages[si];
    if (st.type === "profile") return renderProfile(st);
    if (st.type === "question") return renderQuestion(st.q);
    if (st.type === "conjoint") return renderTask();
  }

  function nextStage() { si++; step = 0; if (si >= stages.length) submit(); else render(); }
  function prevStage() {
    if (si === 0) return;
    si--;
    if (stages[si].type === "conjoint") step = (data.tasks.length - 1);
    render();
  }

  function renderProfile(st) {
    const fields = st.fields;
    const fieldHtml = fields.map(f => {
      const req = f.required ? ' <span style="color:#C8553D">*</span>' : '';
      const help = f.help ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(f.help)}</div>` : '';
      const cur = demo[f.key] || "";
      if (f.type === "single") {
        const opts = (f.options || []).map(o => `<option value="${esc(o)}" ${cur === o ? "selected" : ""}>${esc(o)}</option>`).join("");
        return `<div style="margin-top:12px"><label class="label">${esc(f.label)}${req}</label>
          <select id="pf_${f.key}"><option value="">— Selecciona —</option>${opts}</select>${help}</div>`;
      }
      return `<div style="margin-top:12px"><label class="label">${esc(f.label)}${req}</label>
        <input id="pf_${f.key}" value="${esc(cur)}" placeholder="${f.required ? "" : "Opcional"}" />${help}</div>`;
    }).join("");
    root.innerHTML = `${header()}
      <div class="card" style="max-width:600px;margin:2vh auto 0">
        <h2 class="h" style="margin-top:0">Registro del entrevistado</h2>
        ${operator ? `<p class="muted" style="margin:4px 0 0">Encuestador: <b>${esc(operator)}</b></p>` : ""}
        <p class="muted">Los campos con * son obligatorios.</p>
        ${fieldHtml}
        <div class="err" id="pf_err" style="margin-top:10px;color:#C8553D"></div>
        <button class="btn primary lg" style="width:100%;justify-content:center;margin-top:18px" onclick="window.__pnext()">Continuar →</button>
      </div>`;
    window.__pnext = () => {
      const faltan = [];
      fields.forEach(f => {
        const el = document.getElementById("pf_" + f.key);
        const val = (el && el.value || "").trim();
        if (f.required && !val) faltan.push(f.label);
        demo[f.key] = val;
      });
      if (faltan.length) { document.getElementById("pf_err").textContent = "Faltan campos obligatorios: " + faltan.join(", ") + "."; return; }
      nextStage();
    };
  }

  function renderQuestion(q) {
    const a = qans[q.id] || {};
    const cfg = q.config || {};
    const req = q.required ? ' <span style="color:#C8553D">*</span>' : '';
    let body = "";

    if (q.qtype === "open") {
      body = `<textarea id="q_open" rows="5" style="width:100%;font-family:inherit;font-size:15px" placeholder="Escribe la respuesta…">${esc(a.answer_text || "")}</textarea>`;
    } else if (q.qtype === "single" || q.qtype === "likert") {
      const sel = (a.answer_options || [])[0];
      const opts = (cfg.options || []).map(o => {
        const t = o.text != null ? o.text : o;
        return `<button class="option ${sel === t ? "sel" : ""}" style="text-align:left" onclick="window.__qsingle('${esc(t).replace(/'/g, "\\'")}')">${esc(t)}</button>`;
      }).join("");
      body = `<div class="options" style="grid-template-columns:1fr;gap:8px">${opts}</div>`;
    } else if (q.qtype === "multi") {
      const sel = new Set(a.answer_options || []);
      const opts = (cfg.options || []).map(o => {
        const t = o.text != null ? o.text : o;
        return `<button class="option ${sel.has(t) ? "sel" : ""}" style="text-align:left" onclick="window.__qmulti('${esc(t).replace(/'/g, "\\'")}')">
          <span style="margin-right:8px">${sel.has(t) ? "\u2611" : "\u2610"}</span>${esc(t)}</button>`;
      }).join("");
      body = `<div class="options" style="grid-template-columns:1fr;gap:8px">${opts}</div>
        <p class="muted" style="font-size:12px">Puedes elegir varias.</p>`;
    } else if (q.qtype === "numeric") {
      const mn = cfg.min != null ? cfg.min : 0, mx = cfg.max != null ? cfg.max : 10;
      const cur = a.answer_num;
      if (mx - mn <= 12) {
        let btns = "";
        for (let v = mn; v <= mx; v++) btns += `<button class="numbtn ${cur === v ? "sel" : ""}" onclick="window.__qnum(${v})">${v}</button>`;
        const labels = cfg.labels || {};
        body = `<div class="numscale">${btns}</div>
          <div class="row" style="justify-content:space-between;margin-top:6px">
            <span class="muted" style="font-size:12px">${esc(labels.min || mn)}</span>
            <span class="muted" style="font-size:12px">${esc(labels.max || mx)}</span></div>`;
      } else {
        body = `<input id="q_num" type="number" min="${mn}" max="${mx}" value="${cur != null ? cur : ""}" style="max-width:160px" oninput="window.__qnuminput(this.value)" />`;
      }
    }

    root.innerHTML = `${header()}
      <div class="card" style="max-width:640px;margin:2vh auto 0">
        <h2 class="h" style="margin-top:0">${esc(q.text)}${req}</h2>
        <div style="margin-top:14px">${body}</div>
        <div class="err" id="q_err" style="margin-top:10px;color:#C8553D"></div>
        <div class="row" style="justify-content:space-between;margin-top:16px">
          <button class="btn ghost" onclick="window.__qprev()" ${si === 0 ? "disabled" : ""}>\u2039 Anterior</button>
          <button class="btn primary lg" onclick="window.__qnext()">Continuar \u2192</button>
        </div>
      </div>`;

    window.__qsingle = (t) => { qans[q.id] = { question_id: q.id, qtype: q.qtype, answer_options: [t] }; render(); };
    window.__qmulti = (t) => {
      const cur = new Set((qans[q.id] && qans[q.id].answer_options) || []);
      if (cur.has(t)) cur.delete(t); else cur.add(t);
      qans[q.id] = { question_id: q.id, qtype: q.qtype, answer_options: [...cur] }; render();
    };
    window.__qnum = (v) => { qans[q.id] = { question_id: q.id, qtype: "numeric", answer_num: v }; render(); };
    window.__qnuminput = (v) => { qans[q.id] = { question_id: q.id, qtype: "numeric", answer_num: v === "" ? null : +v }; };
    window.__qprev = () => prevStage();
    window.__qnext = () => {
      if (q.qtype === "open") {
        const v = (document.getElementById("q_open").value || "").trim();
        qans[q.id] = { question_id: q.id, qtype: "open", answer_text: v };
      }
      const a2 = qans[q.id] || {};
      if (q.required) {
        const empty = q.qtype === "open" ? !(a2.answer_text || "").trim()
          : q.qtype === "numeric" ? (a2.answer_num == null)
            : !((a2.answer_options || []).length);
        if (empty) { document.getElementById("q_err").textContent = "Esta pregunta es obligatoria."; return; }
      }
      nextStage();
    };
  }

  function renderTask() {
    const task = data.tasks[step];
    const cols = Math.min(task.options.length, 3);
    root.innerHTML = `${header()}
      <div class="card">
        <h2 class="h">De las siguientes opciones, \u00bfcu\u00e1l elegir\u00edas?</h2>
        <p class="muted" style="font-size:12px">Tarea ${step + 1} de ${data.tasks.length}</p>
        <div class="options" style="grid-template-columns:repeat(${cols},1fr)">
          ${task.options.map((opt, i) => `
            <button class="option ${answers[task.task_index] === i ? "sel" : ""}" onclick="window.__choose(${i})">
              <div class="letter">${LETTERS[i]}</div>
              ${opt.items.map((it) => `<div class="r"><span class="k">${esc(it.attribute_name)}</span><span class="val">${esc(it.category_name)}</span></div>`).join("")}
            </button>`).join("")}
        </div>
        <div class="row" style="justify-content:space-between">
          <button class="btn ghost" onclick="window.__prev()">\u2039 Anterior</button>
          <button class="btn primary lg" onclick="window.__next()" ${answers[task.task_index] === undefined ? "disabled" : ""}>
            ${step < data.tasks.length - 1 ? "Siguiente \u203a" : "Continuar \u2192"}</button>
        </div>
      </div>`;
    window.__choose = (i) => { answers[data.tasks[step].task_index] = i; render(); };
    window.__prev = () => { if (step > 0) { step--; render(); } else prevStage(); };
    window.__next = () => { if (step < data.tasks.length - 1) { step++; render(); } else nextStage(); };
  }

  async function submit() {
    const payload = {
      name: "Anónimo",
      operator: operator,
      profile: demo,
      question_answers: Object.values(qans),
      tasks: data.tasks || [],
      answers: Object.entries(answers).map(([k, v]) => ({ task_index: +k, chosen_option_index: v })),
    };
    try {
      const res = await fetch(`/api/survey/${token}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
      renderDone();
    } catch (e) { toast(e.message); }
  }

  function renderDone() {
    root.innerHTML = `<div class="card" style="max-width:480px;margin:12vh auto 0;text-align:center">
      <div style="font-size:46px">\u2713</div>
      <h2 class="h">\u00a1Gracias!</h2>
      <p class="muted">Las respuestas se guardaron correctamente.</p>
      <button class="btn primary lg" style="margin-top:18px" onclick="window.__nueva()">Iniciar nueva entrevista \u2192</button></div>`;
    window.__nueva = () => { load(); };
  }

  load();
})();
