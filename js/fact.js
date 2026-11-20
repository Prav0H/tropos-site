// Проект: план → выполнение → приёмка → акт (по образцу «Включи систему»).
// План — редактор графика (gpr.js). После запуска у каждой работы появляется факт: начата, завершена, принята, в акте.
// Всё хранится в projects.gpr: у строки who (ответственный), state plan|work|done|accepted, fs/fe (факт. даты),
// acc_at/acc_by (приёмка), act_id (акт), note (замечание при возврате). gpr.launched — дата запуска в работу.
import { sb, S, check, personName, createAct } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast, modal, confirmBox, field, formData, busy, pill } from "./ui.js?v=15";
import { today, nextWorkday, parse, iso } from "./calendar.js?v=15";
import { gprEditor, gprStageRows, gprEnd, mkS, resolve, workDates, amountOf } from "./gpr.js?v=15";
import { generateDoc } from "./views.js?v=15";

const STATE = { plan: ["Не начата", ""], work: ["В работе", "warn"], done: ["Ждёт приёмки", "info"], accepted: ["Принята", "good"] };
const stateOf = (x) => x.state || (x.done ? "done" : "plan");
const setState = (x, st) => { x.state = st; x.done = st === "done" || st === "accepted"; };
const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const dm = (s) => (s ? d(s).slice(0, 5) : "—");
const plural = (n, f) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return f[2]; if (n1 > 1 && n1 < 5) return f[1]; if (n1 === 1) return f[0]; return f[2]; };
const nWorks = (n) => `${n} ${plural(n, ["работа", "работы", "работ"])}`;

/** Работы графика: работы этапов, а этап без работ сам считается работой. */
export const leaves = (gpr) => ((gpr && gpr.stages) || []).flatMap((s) => ((s.works || []).length ? s.works.map((w) => ({ x: w, stage: s })) : [{ x: s, stage: s, solo: true }]));
function planDates(gpr, start) {
  const { res, total } = resolve(gpr), dates = workDates(start, Math.max(1, total));
  const out = {};
  Object.values(res).forEach((r) => (out[r.id] = { s: dates[Math.min(r.start, dates.length - 1)], e: dates[Math.min(dates.length - 1, Math.max(r.start, r.end - 1))] }));
  return out;
}
const syncStageDone = (gpr) => gpr.stages.forEach((s) => { if ((s.works || []).length) s.done = s.works.every((w) => w.done); });

export async function saveGpr(p, gpr, start) {
  const end = gprEnd(gpr, start);
  check(await sb.from("projects").update({ gpr, start_date: start, end_date: end }).eq("id", p.id));
  await sb.from("project_stages").delete().eq("project_id", p.id);
  const rows = gprStageRows(gpr, start).map((r) => ({ ...r, project_id: p.id }));
  if (rows.length) await sb.from("project_stages").insert(rows);
  p.gpr = gpr; p.start_date = start; p.end_date = end;
}

async function loadGpr(p) {
  let gpr = p.gpr;
  if (!gpr || !gpr.stages) { // старые этапы → этапы без работ
    const old = check(await sb.from("project_stages").select("*").eq("project_id", p.id).order("sort"));
    gpr = { stages: old.map((o) => mkS(o.name, [], { dur: o.days || 1 })) };
    old.forEach((o, i) => (gpr.stages[i].done = o.done));
  }
  gpr.stages.forEach((s) => (s.works = s.works || []));
  return gpr;
}
const startOf = (p) => p.start_date || nextWorkday(today());
const dueIso = (date) => new Date(`${date}T18:00:00`).toISOString();

/* ---------- связь с задачами: задача по работе графика ---------- */
async function linkedTasks(p) { return check(await sb.from("tasks").select("id,gpr_id,status,done_at,assignee,due_at").eq("project_id", p.id).not("gpr_id", "is", null)); }
/** Отмеченная выполненной задача завершает работу; у открытых задач срок и исполнитель — по плану. */
async function syncTasks(p, gpr, start) {
  const tasks = await linkedTasks(p), L = leaves(gpr), PD = planDates(gpr, start);
  let changed = false;
  for (const t of tasks) {
    const l = L.find((q) => q.x.id === t.gpr_id); if (!l) continue;
    const x = l.x, st = stateOf(x);
    if (t.status === "done") {
      if (st === "plan" || st === "work") { setState(x, "done"); x.fe = iso(new Date(t.done_at || Date.now())); if (!x.fs || x.fs > x.fe) x.fs = PD[x.id].s < x.fe ? PD[x.id].s : x.fe; x.note = ""; changed = true; }
    } else {
      const patch = {};
      if ((x.who || null) !== (t.assignee || null) && x.who) patch.assignee = x.who;
      if (!t.due_at || iso(new Date(t.due_at)) !== PD[x.id].e) patch.due_at = dueIso(PD[x.id].e);
      if (Object.keys(patch).length) await sb.from("tasks").update(patch).eq("id", t.id);
    }
  }
  if (changed) { syncStageDone(gpr); await saveGpr(p, gpr, start); }
  return tasks;
}
async function pushTask(p, x, status) {
  await sb.from("tasks").update({ status, done_at: status === "done" ? new Date().toISOString() : null }).eq("project_id", p.id).eq("gpr_id", x.id);
}
async function makeTasks(p, gpr, start, have) {
  const PD = planDates(gpr, start), got = new Set(have.map((t) => t.gpr_id));
  const rows = leaves(gpr).filter((l) => l.x.who && !got.has(l.x.id) && ["plan", "work"].includes(stateOf(l.x))).map((l) => ({
    project_id: p.id, title: l.x.title || "Работа", assignee: l.x.who, stage_name: l.solo ? "" : l.stage.title || "", due_at: dueIso(PD[l.x.id].e), auto: true, gpr_id: l.x.id,
    status: stateOf(l.x) === "work" ? "doing" : "todo",
    description: "Работа из графика проекта. Когда закончите — отметьте задачу выполненной: работа уйдёт на приёмку.",
  }));
  if (rows.length) check(await sb.from("tasks").insert(rows));
  return rows.length;
}

function tabCount(gpr) {
  const a = document.querySelector('.pj-page-head .tabs a[href$="/accept"]'); if (!a) return;
  const n = leaves(gpr).filter((l) => stateOf(l.x) === "done").length;
  a.innerHTML = `Приёмка${n ? ` <em class="tab-n">${n}</em>` : ""}`;
}
/* ---------- шаги проекта: план → выполнение → приёмка → акты ---------- */
function flowBar(p, gpr, cur, nActs) {
  const L = leaves(gpr), cnt = (st) => L.filter((l) => stateOf(l.x) === st).length, base = `#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}`;
  const steps = [
    ["plan", "План", L.length ? nWorks(L.length) : "этапы, сроки, ответственные", `${base}/schedule/plan`, true],
    ["fact", "Выполнение", gpr.launched ? `в работе ${cnt("work")}, не начато ${cnt("plan")}` : "после запуска", `${base}/schedule/fact`, !!gpr.launched],
    ["accept", "Приёмка", gpr.launched ? `ждут ${cnt("done")}, принято ${cnt("accepted")}` : "после запуска", `${base}/accept`, !!gpr.launched],
    ...(p.kind === "client" ? [["acts", "Акты", nActs == null ? "по принятым работам" : nActs ? `${nActs} ${plural(nActs, ["акт", "акта", "актов"])}` : "пока нет", `${base}/accept`, !!gpr.launched]] : []),
  ];
  const ci = steps.findIndex((s) => s[0] === cur);
  tabCount(gpr);
  return `<div class="flow">${steps.map(([k, t, s, h, on], i) => `<a class="flow-s${k === cur ? " on" : ""}${i < ci ? " past" : ""}${on ? "" : " off"}" ${on ? `href="${h}"` : ""}><i>${i + 1}</i><span><b>${t}</b><small>${esc(s)}</small></span></a>`).join("")}</div>`;
}

/* ====================== график работ: план и выполнение ====================== */
export async function scheduleTab(pb, p, contract, mode) {
  const gpr = await loadGpr(p), start = startOf(p);
  const launched = !!gpr.launched;
  if (!launched || !["plan", "fact"].includes(mode)) mode = launched ? "fact" : "plan";
  if (mode === "fact") return factView(pb, p, contract, gpr, start);
  const L = leaves(gpr);
  pb.innerHTML = `${flowBar(p, gpr, "plan")}
    <div class="phase ${launched ? "run" : ""}">${launched
      ? `<div><b>Проект в работе с ${d(gpr.launched)}.</b> Правки здесь меняют плановые сроки и ответственных; задачи по работам обновятся сами.</div><a class="btn primary" href="#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}/schedule/fact">К выполнению →</a>`
      : `<div><b>Планирование.</b> Расставьте этапы и работы, сроки и ответственных. Когда план готов — запустите проект в работу.</div><button class="btn primary" data-launch ${L.length ? "" : "disabled"}>▶ Запустить в работу</button>`}</div>
    <div data-ed></div>`;
  const edr = gprEditor(pb.querySelector("[data-ed]"), {
    gpr, start, total: contract ? contract.total : p.budget, people: S.people.filter((x) => x.active !== false).map((x) => ({ id: x.id, name: x.name })),
    extraButtons: contract && !launched ? `<button class="btn sm" data-fromc>Собрать из услуг договора</button>` : "",
    onSave: async (g) => { try { g.launched = gpr.launched; await saveGpr(p, g, start); } catch (e) { toast("График не сохранён: " + e.message, true); } },
  });
  const fc = pb.querySelector("[data-fromc]");
  if (fc) fc.onclick = async () => { if (gpr.stages.length && !(await confirmBox("Собрать график заново из услуг договора? Текущий график заменится.", "Собрать"))) return; edr.cancel(); const { buildSchedule } = await import("./projects.js?v=15"); const n = await buildSchedule(p, contract); toast(`Работ в графике: ${n}`); scheduleTab(pb, p, contract, "plan"); };
  const lb = pb.querySelector("[data-launch]");
  if (lb) lb.onclick = async () => {
    await edr.flush();
    const g = p.gpr && p.gpr.stages ? p.gpr : gpr, LL = leaves(g), noWho = LL.filter((l) => !l.x.who).length, end = gprEnd(g, start);
    if (!LL.length) return toast("Сначала добавьте в план хотя бы одну работу", true);
    modal({
      title: "Запустить проект в работу",
      body: `<p style="margin:0">В плане <b>${nWorks(LL.length)}</b>, срок ${d(start)} — ${d(end)}.</p>
        ${noWho ? `<div class="note">У ${nWorks(noWho)} нет ответственного — задачи по ним не поставятся. Можно вернуться и назначить.</div>` : ""}
        ${field("Дата запуска", "date", today(), { type: "date" })}
        <label class="chk"><input type="checkbox" name="tasks" checked> Поставить задачи ответственным — по одной на работу, срок по плану</label>
        <div class="small muted">После запуска откроется «Выполнение»: там работы начинают и завершают. Завершённые уходят в «Приёмку», из принятых делается акт. План можно править и после запуска.</div>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Запустить</button>`,
      onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async (e) => {
        const v = formData(el); busy(e.target, true, "Запускаю…");
        try {
          g.launched = v.date || today();
          await saveGpr(p, g, start);
          if (["planned", "paused"].includes(p.status)) { await sb.from("projects").update({ status: "active" }).eq("id", p.id); p.status = "active"; }
          const n = v.tasks ? await makeTasks(p, g, start, await linkedTasks(p)) : 0;
          close(); toast(n ? `Проект запущен, задач поставлено: ${n}` : "Проект запущен в работу");
          location.hash = `#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}/schedule/fact`;
        } catch (err) { toast(err.message, true); busy(e.target, false); }
      }),
    });
  };
}

async function factView(pb, p, contract, gpr, start) {
  const tasks = await syncTasks(p, gpr, start);
  const L = leaves(gpr), PD = planDates(gpr, start), t = today();
  const re = () => factView(pb, p, contract, gpr, start);
  const save = async () => { syncStageDone(gpr); await saveGpr(p, gpr, start); };
  const cnt = (st) => L.filter((l) => stateOf(l.x) === st).length;
  const isLate = (x) => ["plan", "work"].includes(stateOf(x)) && PD[x.id].e < t;
  const late = L.filter((l) => isLate(l.x)).length, ready = cnt("done") + cnt("accepted");
  const noTask = L.filter((l) => l.x.who && ["plan", "work"].includes(stateOf(l.x)) && !tasks.some((k) => k.gpr_id === l.x.id)).length;
  // общая шкала для полос «план / факт»
  const all = L.flatMap((l) => [PD[l.x.id].s, PD[l.x.id].e, l.x.fs, l.x.fe].filter(Boolean)).concat(L.length ? [t] : []).sort();
  const min = all[0] || t, span = Math.max(1, days(min, all[all.length - 1] || t) + 1);
  const pos = (a, b) => `left:${(days(min, a) / span) * 100}%;width:${Math.max(1.5, ((days(a, b) + 1) / span) * 100)}%`;
  const row = (l) => {
    const x = l.x, st = stateOf(x), pd = PD[x.id], lateD = isLate(x) ? days(pd.e, t) : 0, over = x.fe && x.fe > pd.e ? days(pd.e, x.fe) : 0;
    const fEnd = x.fe || (st === "work" ? t : null);
    const act = st === "plan" ? `<button class="btn sm" data-go="start" data-id="${x.id}">Начать</button>` : st === "work" ? `<button class="btn sm primary" data-go="finish" data-id="${x.id}">✓ Завершить</button>` : st === "done" ? `<button class="btn sm ghost" data-go="back" data-id="${x.id}" title="Вернуть в работу">↺</button>` : "";
    return `<tr class="fx-r st-${st}"><td class="fx-name${l.solo ? "" : " sub"}"><b>${esc(x.title || "Работа")}</b>${x.note ? `<div class="small" style="color:var(--bad)">Возвращено с приёмки: ${esc(x.note)}</div>` : ""}</td>
      <td class="small">${x.who ? esc(personName(x.who)) : `<span class="muted">не назначен</span>`}</td>
      <td class="nowrap small">${dm(pd.s)} – ${dm(pd.e)}</td>
      <td class="nowrap small"><button class="fx-fact" data-fact="${x.id}" title="Изменить фактические даты">${x.fs ? `${dm(x.fs)} – ${x.fe ? dm(x.fe) : "…"}` : `<span class="muted">—</span>`}</button></td>
      <td class="fx-tl"><div class="fx-line"><i class="pl" style="${pos(pd.s, pd.e)}"></i>${x.fs ? `<i class="fc${over || lateD ? " late" : ""}${st === "work" ? " run" : ""}" style="${pos(x.fs, fEnd < x.fs ? x.fs : fEnd)}"></i>` : ""}<u style="left:${((days(min, t) + 0.5) / span) * 100}%"></u></div></td>
      <td class="nowrap"><span class="st ${STATE[st][1]}">${STATE[st][0]}</span>${lateD ? `<div class="small" style="color:var(--bad)">просрочено ${lateD} дн.</div>` : over ? `<div class="small" style="color:var(--warn)">позже на ${over} дн.</div>` : x.fe ? `<div class="small muted">в срок</div>` : ""}</td>
      <td class="n nowrap">${act}</td></tr>`;
  };
  const body = gpr.stages.map((s) => {
    if (!s.works.length) return row({ x: s, stage: s, solo: true });
    const dn = s.works.filter((w) => w.done).length;
    return `<tr class="fx-stage"><td colspan="5">${esc(s.title || "Этап")}</td><td colspan="2" class="n small">${dn} из ${s.works.length} завершено</td></tr>${s.works.map((w) => row({ x: w, stage: s })).join("")}`;
  }).join("");
  pb.innerHTML = `${flowBar(p, gpr, "fact")}
    <div class="grid4 fx-kpi">
      <div class="card kpi"><div class="small muted">Готовность</div><div class="v">${L.length ? Math.round((ready / L.length) * 100) : 0}%</div><div class="bar"><i style="width:${L.length ? (ready / L.length) * 100 : 0}%"></i></div></div>
      <div class="card kpi"><div class="small muted">В работе</div><div class="v">${cnt("work")}</div><div class="s">не начато ${cnt("plan")}</div></div>
      <div class="card kpi"><div class="small muted">Ждут приёмки</div><div class="v" style="${cnt("done") ? "color:var(--info)" : ""}">${cnt("done")}</div><div class="s">принято ${cnt("accepted")} из ${L.length}</div></div>
      <div class="card kpi"><div class="small muted">Просрочено</div><div class="v" style="${late ? "color:var(--bad)" : ""}">${late}</div><div class="s">плановый срок прошёл</div></div></div>
    <div class="row between" style="margin:14px 0 10px"><span class="small muted">В работе с ${d(gpr.launched)}. Серая полоса — план, цветная — факт, оранжевая черта — сегодня.</span>
      <div class="row">${noTask ? `<button class="btn sm" data-mk>Поставить задачи по работам (${noTask})</button>` : ""}<a class="btn sm" href="#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}/schedule/plan">Изменить план</a>${cnt("done") ? `<a class="btn sm primary" href="#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}/accept">Приёмка · ${cnt("done")}</a>` : ""}</div></div>
    <div class="card flush">${L.length ? `<div class="tw"><table class="t fx"><tr><th>Работа</th><th>Ответственный</th><th>План</th><th>Факт</th><th style="min-width:180px">План / факт</th><th>Статус</th><th></th></tr>${body}</table></div>` : `<div class="empty" style="border:0">В плане нет работ</div>`}</div>`;
  const find = (id) => L.find((l) => l.x.id === id).x;
  $$("[data-go]", pb).forEach((b) => (b.onclick = async () => {
    const x = find(b.dataset.id), go = b.dataset.go; busy(b, true);
    try {
      if (go === "start") { setState(x, "work"); x.fs = t; x.fe = null; await pushTask(p, x, "doing"); }
      if (go === "finish") { setState(x, "done"); x.fe = t; if (!x.fs || x.fs > t) x.fs = t; x.note = ""; await pushTask(p, x, "done"); }
      if (go === "back") { setState(x, "work"); x.fe = null; await pushTask(p, x, "doing"); }
      await save(); if (go === "finish") toast("Работа завершена и ушла на приёмку"); re();
    } catch (e) { toast(e.message, true); busy(b, false); }
  }));
  $$("[data-fact]", pb).forEach((b) => (b.onclick = () => {
    const x = find(b.dataset.fact);
    modal({ title: x.title || "Работа", body: `<div class="grid2">${field("Начата", "fs", x.fs || "", { type: "date" })}${field("Завершена", "fe", x.fe || "", { type: "date" })}</div><div class="small muted">Пустая дата завершения — работа ещё идёт. Обе пустые — работа не начата.</div>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
      onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async () => {
        const v = formData(el); if (v.fe && !v.fs) v.fs = v.fe; if (v.fe && v.fe < v.fs) return toast("Завершение раньше начала", true);
        const st = stateOf(x); x.fs = v.fs || null; x.fe = v.fe || null;
        if (st !== "accepted") { const ns = v.fe ? "done" : v.fs ? "work" : "plan"; if (ns !== st) { setState(x, ns); await pushTask(p, x, ns === "done" ? "done" : ns === "work" ? "doing" : "todo"); } }
        await save(); close(); re();
      }) });
  }));
  const mk = $("[data-mk]", pb); if (mk) mk.onclick = async () => { busy(mk, true); try { const n = await makeTasks(p, gpr, start, tasks); toast(`Задач поставлено: ${n}`); re(); } catch (e) { toast(e.message, true); busy(mk, false); } };
}

/* ====================== приёмка работ и акты ====================== */
export async function acceptTab(pb, p, contract, client) {
  const gpr = await loadGpr(p), start = startOf(p);
  if (gpr.launched) await syncTasks(p, gpr, start);
  const acts = p.kind === "client" ? check(await sb.from("acts").select("*").eq("project_id", p.id).order("year").order("seq")) : [];
  const L = leaves(gpr), PD = planDates(gpr, start), t = today(), base = `#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}`;
  const re = () => acceptTab(pb, p, contract, client);
  const save = async () => { syncStageDone(gpr); await saveGpr(p, gpr, start); };
  const actOf = (x) => acts.find((a) => a.id === x.act_id);
  const wait = L.filter((l) => stateOf(l.x) === "done"), free = L.filter((l) => stateOf(l.x) === "accepted" && !actOf(l.x)), inAct = L.filter((l) => stateOf(l.x) === "accepted" && actOf(l.x));
  const total = contract ? Number(contract.total) : Number(p.budget) || 0;
  const sumOf = (x) => Math.round(amountOf(x.amount, total).rub * 100) / 100;
  if (!gpr.launched) { pb.innerHTML = `${flowBar(p, gpr, "accept", acts.length)}<div class="empty">Приёмка откроется после запуска проекта в работу. Сначала составьте план во вкладке <a href="${base}/schedule">«График работ»</a>.</div>`; return; }
  const tbl = (list, key, cols, cell) => `<div class="tw"><table class="t"><tr><th style="width:34px"><input type="checkbox" data-all="${key}" checked></th><th>Работа</th><th>Ответственный</th>${cols}</tr>${list.map((l) => `<tr><td><input type="checkbox" data-${key}="${l.x.id}" checked></td><td><b>${esc(l.x.title || "Работа")}</b>${l.solo ? "" : `<div class="small muted">${esc(l.stage.title || "")}</div>`}</td><td class="small">${l.x.who ? esc(personName(l.x.who)) : "—"}</td>${cell(l.x)}</tr>`).join("")}</table></div>`;
  pb.innerHTML = `${flowBar(p, gpr, "accept", acts.length)}
    <div class="card flush"><div class="acc-h"><div><div class="sec-t" style="margin:0">Ждут приёмки · ${wait.length}</div><div class="small muted">Работы, которые исполнитель отметил завершёнными. Проверьте результат и примите или верните на доработку.</div></div>
        ${wait.length ? `<div class="row"><button class="btn" data-ret>↺ Вернуть на доработку</button><button class="btn primary" data-acc>✓ Принять выбранные</button></div>` : ""}</div>
      ${wait.length ? tbl(wait, "w", `<th>План</th><th>Завершена</th>`, (x) => `<td class="nowrap small">${dm(PD[x.id].s)} – ${dm(PD[x.id].e)}</td><td class="nowrap small">${d(x.fe)}${x.fe > PD[x.id].e ? ` <span style="color:var(--warn)">+${days(PD[x.id].e, x.fe)} дн.</span>` : ""}</td>`) : `<div class="empty" style="border:0">Пока нечего принимать. Работы появятся здесь после кнопки «Завершить» во вкладке <a href="${base}/schedule/fact">«График работ»</a>.</div>`}</div>
    <div class="card flush"><div class="acc-h"><div><div class="sec-t" style="margin:0">Принято${p.kind === "client" ? ", ещё не в акте" : ""} · ${free.length}</div>${p.kind === "client" ? `<div class="small muted">${contract ? "Отметьте работы и сформируйте акт — он появится в «Документация → Акты» и в карточке договора." : "Акт формируется по договору. Укажите договор проекта в «Настроить»."}</div>` : ""}</div>
        ${free.length && p.kind === "client" && contract ? `<button class="btn grad" data-mkact>Сформировать акт</button>` : ""}</div>
      ${free.length ? tbl(free, "f", `<th>Принята</th><th class="n">Сумма</th><th></th>`, (x) => `<td class="nowrap small">${d(x.acc_at)}${x.acc_by ? ` · ${esc(personName(x.acc_by))}` : ""}</td><td class="n">${sumOf(x) ? rub(sumOf(x)) : `<span class="muted">—</span>`}</td><td class="n"><button class="btn sm ghost" data-unacc="${x.id}" title="Отменить приёмку">↺</button></td>`) : `<div class="empty" style="border:0">Нет принятых работ без акта</div>`}</div>
    ${p.kind === "client" ? `<div class="card flush"><div class="acc-h"><div class="sec-t" style="margin:0">Акты проекта · ${acts.length}</div>${contract ? `<a class="small" href="#/contracts/${contract.id}">Отправка и подписание — в карточке договора →</a>` : ""}</div>
      ${acts.length ? `<div class="tw"><table class="t"><tr><th>Акт</th><th>Работы</th><th>Статус</th><th class="n">Сумма</th><th></th></tr>${acts.map((a) => `<tr><td class="nowrap"><b>№ ${esc(a.number)}</b><div class="small muted">${d(a.date)}</div></td><td class="small">${(a.services || []).map((s) => esc(s.name)).join("; ")}</td><td>${pill("act", a.status)}</td><td class="n">${rub(a.amount)}</td><td class="n nowrap">${a.files && a.files.pdf ? `<button class="btn sm" data-dl="${esc(a.files.pdf)}" data-name="${esc(a.files.name)}.pdf">PDF</button> <button class="btn sm" data-dl="${esc(a.files.docx)}" data-name="${esc(a.files.name)}.docx">Word</button>` : ""}</td></tr>`).join("")}</table></div>` : `<div class="empty" style="border:0">Актов пока нет</div>`}</div>` : ""}
    ${inAct.length ? `<details class="rq-more"><summary class="small muted">Работы, уже вошедшие в акты (${inAct.length})</summary><div class="card flush"><table class="t">${inAct.map((l) => `<tr><td>${esc(l.x.title)}</td><td class="small muted">${esc(l.solo ? "" : l.stage.title)}</td><td class="n small">акт № ${esc(actOf(l.x).number)}</td></tr>`).join("")}</table></div></details>` : ""}`;
  const picked = (key) => $$(`[data-${key}]`, pb).filter((c) => c.checked).map((c) => L.find((l) => l.x.id === c.dataset[key]).x);
  $$("[data-all]", pb).forEach((c) => (c.onchange = () => $$(`[data-${c.dataset.all}]`, pb).forEach((x) => (x.checked = c.checked))));
  $$("[data-dl]", pb).forEach((b) => (b.onclick = async () => { const { data } = await sb.storage.from("docs").createSignedUrl(b.dataset.dl, 3600, { download: b.dataset.name }); if (data) window.open(data.signedUrl, "_blank"); }));
  const acc = $("[data-acc]", pb); if (acc) acc.onclick = async () => {
    const xs = picked("w"); if (!xs.length) return toast("Отметьте работы", true);
    busy(acc, true); xs.forEach((x) => { setState(x, "accepted"); x.acc_at = t; x.acc_by = S.profile.person_id || null; x.note = ""; });
    try { await save(); toast(`Принято: ${nWorks(xs.length)}`); re(); } catch (e) { toast(e.message, true); }
  };
  const ret = $("[data-ret]", pb); if (ret) ret.onclick = () => {
    const xs = picked("w"); if (!xs.length) return toast("Отметьте работы", true);
    modal({ title: `Вернуть на доработку: ${nWorks(xs.length)}`, body: field("Что доделать", "note", "", { rows: 3, ph: "Замечание увидит исполнитель в графике работ" }),
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Вернуть</button>`,
      onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async () => {
        const note = formData(el).note || "нужна доработка";
        for (const x of xs) { setState(x, "work"); x.fe = null; x.note = note; await pushTask(p, x, "doing"); }
        await save(); close(); toast("Возвращено в работу"); re();
      }) });
  };
  $$("[data-unacc]", pb).forEach((b) => (b.onclick = async () => { const x = L.find((l) => l.x.id === b.dataset.unacc).x; setState(x, "done"); x.acc_at = null; x.acc_by = null; await save(); re(); }));
  const mk = $("[data-mkact]", pb); if (mk) mk.onclick = async () => {
    const xs = picked("f"); if (!xs.length) return toast("Отметьте работы для акта", true);
    const stages = contract.stages && contract.stages.length ? contract.stages : [{ n: 1, name: "Внедрение", amount: contract.total }];
    const cActs = check(await sb.from("acts").select("stage,amount,status").eq("contract_id", contract.id));
    const rest = (n) => Math.max(0, Number((stages.find((s) => s.n === n) || stages[0]).amount) - cActs.filter((a) => a.stage === n && a.status !== "rejected").reduce((s, a) => s + Number(a.amount), 0));
    const byWorks = Math.round(xs.reduce((s, x) => s + sumOf(x), 0) * 100) / 100;
    modal({
      title: "Акт по принятым работам",
      body: `<div class="grid3">${field("Дата акта", "date", t, { type: "date" })}${field("Этап договора", "stage", stages[0].n, { options: stages.map((s) => [s.n, `Этап ${s.n}. ${s.name}`]) })}${field("Сумма акта, ₽", "amount", byWorks || rest(stages[0].n), { type: "number", attrs: 'min="0" step="0.01"' })}</div>
        <div class="small muted" data-hint></div>
        <div><div class="sec-t">В акт войдут · ${xs.length}</div><ol class="act-list">${xs.map((x) => `<li>${esc(x.title)}${sumOf(x) ? ` <span class="muted">— ${rub(sumOf(x))}</span>` : ""}</li>`).join("")}</ol></div>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сформировать акт (PDF и Word)</button>`,
      onMount: (el, close) => {
        const st = el.querySelector("[name=stage]"), am = el.querySelector("[name=amount]"), hint = el.querySelector("[data-hint]");
        const upd = (setAmt) => { const n = Number(st.value), s = stages.find((q) => q.n === n); if (setAmt && !byWorks) am.value = rest(n); hint.textContent = `${byWorks ? `По суммам работ в графике: ${rub(byWorks)}. ` : "У работ в графике суммы не заданы. "}Этап ${n} по договору: ${rub(s.amount)}, ещё не закрыто актами: ${rub(rest(n))}.`; };
        st.onchange = () => upd(true); upd(false);
        el.querySelector("[data-ok]").onclick = async (e) => {
          const v = formData(el); if (!(v.amount > 0)) return toast("Укажите сумму акта", true);
          busy(e.target, true, "Собираю акт…");
          try {
            const cl = client || check(await sb.from("clients").select("*").eq("id", contract.client_id).single());
            const services = xs.map((x) => { const cs = (contract.services || []).find((s) => s.name === x.title); return { name: x.title, result: cs ? cs.result || "" : "", gpr_id: x.id, amount: sumOf(x) }; });
            const act = await createAct(contract, Number(v.stage), { services, amount: v.amount, project_id: p.id, date: v.date || t });
            xs.forEach((x) => (x.act_id = act.id)); await save();
            await generateDoc("Акт", act, contract, cl, "acts");
            close(); toast(`Акт № ${act.number} готов — он в «Документация → Акты»`); re();
          } catch (err) { toast(err.message, true); busy(e.target, false); }
        };
      },
    });
  };
}
