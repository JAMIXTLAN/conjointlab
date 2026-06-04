/* ConjointLab — encuesta pública */
(() => {
  const root = document.getElementById("survey-root");
  const params = new URLSearchParams(location.search);
  const token = params.get("study");
  const operator = params.get("op") || "";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  let data = null;        // {study_name, tasks:[...]}
  let phase = "demo";     // demo | tasks | done
  let step = 0;
  let answers = {};       // task_index -> chosen_option_index
  let demo = { name: "", age: "", sex: "", municipality: "" };

  function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }

  async function load() {
    if (!token) { root.innerHTML = `<div class="empty"><p>Falta el identificador de la encuesta.</p></div>`; return; }
    try {
      const res = await fetch(`/api/survey/${token}/start`);
      if (!res.ok) throw new Error("Encuesta no encontrada");
      data = await res.json();
      render();
    } catch (e) { root.innerHTML = `<div class="empty"><p class="err">${e.message}</p></div>`; }
  }

  function render() {
    if (phase === "demo") return renderDemo();
    if (phase === "done") return renderDone();
    renderTask();
  }

  function renderDemo() {
    root.innerHTML = `
      <div class="card" style="max-width:560px;margin:8vh auto 0">
        <div class="eyebrow">${esc(data.study_name)}</div>
        <h2 class="h" style="margin-top:6px">Antes de empezar</h2>
        ${operator ? `<p class="muted" style="margin:4px 0 0">Operador: <b>${esc(operator)}</b></p>` : ""}
        <p class="muted">Datos opcionales para análisis posterior.</p>
        <div style="margin-top:14px"><label class="label">Tu nombre (opcional)</label><input id="d-name" placeholder="Anónimo" /></div>
        <div class="grid3" style="margin-top:10px">
          <div><label class="label">Edad</label><input id="d-age" class="mono" placeholder="—" /></div>
          <div><label class="label">Sexo</label><input id="d-sex" placeholder="—" /></div>
          <div><label class="label">Municipio</label><input id="d-mun" placeholder="—" /></div>
        </div>
        <button class="btn primary lg" style="width:100%;justify-content:center;margin-top:18px" onclick="window.__startTasks()">Comenzar →</button>
      </div>`;
    window.__startTasks = () => {
      demo = {
        name: document.getElementById("d-name").value.trim() || "Anónimo",
        age: document.getElementById("d-age").value.trim(),
        sex: document.getElementById("d-sex").value.trim(),
        municipality: document.getElementById("d-mun").value.trim(),
      };
      phase = "tasks"; step = 0; render();
    };
  }

  function renderTask() {
    const task = data.tasks[step];
    const cols = Math.min(task.options.length, 3);
    root.innerHTML = `
      <div class="eyebrow">${esc(data.study_name)}</div>
      <div class="progress"><div class="track"><div style="width:${(step / data.tasks.length) * 100}%"></div></div>
        <span class="mono muted">${step + 1} / ${data.tasks.length}</span></div>
      <div class="card">
        <h2 class="h">De las siguientes opciones, ¿cuál elegirías?</h2>
        <div class="options" style="grid-template-columns:repeat(${cols},1fr)">
          ${task.options.map((opt, i) => `
            <button class="option ${answers[task.task_index] === i ? "sel" : ""}" onclick="window.__choose(${i})">
              <div class="letter">${LETTERS[i]}</div>
              ${opt.items.map((it) => `<div class="r"><span class="k">${esc(it.attribute_name)}</span><span class="val">${esc(it.category_name)}</span></div>`).join("")}
            </button>`).join("")}
        </div>
        <div class="row" style="justify-content:space-between">
          <button class="btn ghost" onclick="window.__prev()" ${step === 0 ? "disabled" : ""}>‹ Anterior</button>
          <button class="btn primary lg" onclick="window.__next()" ${answers[task.task_index] === undefined ? "disabled" : ""}>
            ${step < data.tasks.length - 1 ? "Siguiente ›" : "Finalizar ✓"}</button>
        </div>
      </div>`;
    window.__choose = (i) => { answers[data.tasks[step].task_index] = i; render(); };
    window.__prev = () => { if (step > 0) { step--; render(); } };
    window.__next = () => { if (step < data.tasks.length - 1) { step++; render(); } else submit(); };
  }

  async function submit() {
    const payload = {
      ...demo,
      operator: operator,
      tasks: data.tasks,
      answers: Object.entries(answers).map(([k, v]) => ({ task_index: +k, chosen_option_index: v })),
    };
    try {
      const res = await fetch(`/api/survey/${token}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
      phase = "done"; render();
    } catch (e) { toast(e.message); }
  }

  function renderDone() {
    root.innerHTML = `<div class="card" style="max-width:480px;margin:12vh auto 0;text-align:center">
      <div style="font-size:46px">✓</div>
      <h2 class="h">¡Gracias!</h2>
      <p class="muted">Tus respuestas se guardaron correctamente.</p></div>`;
  }

  load();
})();
