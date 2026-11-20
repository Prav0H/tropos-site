// Проекты (клиентские) и Развитие (внутренние): обзор, график работ, финансы, задачи, файлы.
import { sb, S, check, personName, uploadFile } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast, modal, confirmBox, field, formData, busy } from "./ui.js?v=15";
import { today, addWorkdays, nextWorkday, parse, iso, isWorkday } from "./calendar.js?v=15";
import { taskBoard } from "./tasks.js?v=15";
import { mkS, mkW } from "./gpr.js?v=15";
import { saveGpr, scheduleTab, acceptTab, leaves } from "./fact.js?v=15";
import { onlyOwn, can } from "./access.js?v=15";
import { opForm, loadFinRefs } from "./finance.js?v=15";
import { applyTemplateDialog } from "./settings2.js?v=15";
import { delHead, delRec, delBtn } from "./del.js?v=15";

const PST = { planned: ["Планируется", "warn"], active: ["В работе", "info"], paused: ["Пауза", ""], done: ["Завершён", "good"], cancelled: ["Отменён", "bad"] };
const PPR = { high: "высокий", medium: "средний", low: "низкий" };
const KIND = { client: { title: "Проекты", one: "Проект", path: "projects" }, dev: { title: "Развитие", one: "Направление развития", path: "dev" } };
const pill = (s) => `<span class="st ${PST[s][1]}">${PST[s][0]}</span>`;

export async function projectsList(main, kind = "client") {
  const K = KIND[kind];
  const [ps, tasks, money, cls] = await Promise.all([sb.from("projects").select("*").eq("kind", kind).order("sort").order("created_at"), sb.from("tasks").select("project_id,status,due_at"), sb.from("fin_ops").select("project_id,type,amount,planned").not("project_id", "is", null), sb.from("clients").select("id,kind,name")]).then((r) => r.map(check));
  if (kind === "client" && onlyOwn("projects")) { const mine = ps.filter((p) => p.responsible === S.profile.person_id); ps.length = 0; ps.push(...mine); }
  let fst = "open";
  const COLORS = { planned: "#ff9a1f", active: "#2357f5", paused: "#b3afa6", done: "#1d7f55", cancelled: "#c0392b" };
  const draw = () => {
    const list = ps.filter((p) => fst === "all" || (fst === "open" ? !["done", "cancelled"].includes(p.status) : p.status === fst));
    $("#pl", main).innerHTML = list.length ? `<div class="pj-grid">${list.map((p) => {
      const tk = tasks.filter((t) => t.project_id === p.id), open = tk.filter((t) => t.status !== "done"), late = open.filter((t) => t.due_at && new Date(t.due_at) < new Date());
      const inc = money.filter((m) => m.project_id === p.id && m.type === "in" && !m.planned).reduce((a, m) => a + Number(m.amount), 0);
      const cl = cls.find((c) => c.id === p.client_id);
      const prog = tk.length ? Math.round(((tk.length - open.length) / tk.length) * 100) : 0;
      const man = personName(p.responsible);
      return `<a class="pj" href="#/${K.path}/${p.id}" style="--pc:${COLORS[p.status]}">
        <div class="pj-head"><h3>${esc(p.name)}</h3>${pill(p.status)}</div>
        <div class="pj-meta"><span>Приоритет: ${PPR[p.priority]}</span>${p.end_date ? `<span>· срок ${d(p.end_date)}</span>` : ""}${cl ? `<span>· ${esc((cl.kind === "ИП" ? "ИП " : cl.kind + " ") + cl.name)}</span>` : ""}</div>
        ${p.description ? `<div class="pj-desc">${esc(p.description)}</div>` : ""}
        <div class="pj-count"><div><b>${open.length}</b><span>открыто задач</span></div><div><b style="${late.length ? "color:var(--bad)" : ""}">${late.length}</b><span>просрочено</span></div><div><b>${prog}%</b><span>выполнено</span></div>${kind === "client" && inc ? `<div><b>${rub(inc)}</b><span>получено</span></div>` : ""}</div>
        <div class="bar"><i style="width:${prog}%"></i></div>
        <div class="pj-man"><span class="tk-ava">${esc(man.split(/\s+/).slice(0, 2).map((x) => x[0]).join(""))}</span><div><small>Ответственный</small>${esc(man)}</div></div></a>`;
    }).join("")}</div>` : `<div class="empty">Пока пусто. Нажмите «+ ${K.one}».</div>`;
  };
  main.innerHTML = `<div class="page-head"><h1>${K.title}</h1><div class="row"><a class="btn" href="#/tasks/${kind}">Все задачи ${kind === "dev" ? "развития" : "проектов"}</a><button class="btn primary" id="np">+ ${K.one}</button></div></div>
    <div class="filters"><select id="fs">${[["open", "Активные"], ["all", "Все"], ...Object.entries(PST).map(([k, [l]]) => [k, l])].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div><div id="pl"></div>`;
  $("#fs", main).onchange = (e) => { fst = e.target.value; draw(); };
  $("#np", main).onclick = () => projectForm({ kind, status: kind === "dev" ? "planned" : "active", priority: "medium", responsible: S.profile.person_id }, cls, (p) => (location.hash = `#/${K.path}/${p.id}`));
  draw();
}

async function delProject(p) {
  const files = check(await sb.from("project_files").select("path").eq("project_id", p.id)).map((f) => f.path);
  await delRec({ table: "projects", id: p.id, what: `${p.kind === "dev" ? "направление" : "проект"} «${p.name}»`, warn: "Вместе с ним удалятся задачи, график и файлы. Операции в «Финансах» и акты останутся, но без привязки к проекту.", files, done: () => (location.hash = `#/${KIND[p.kind].path}`) });
}
function projectForm(p, cls, done, cts) {
  modal({
    title: p.id ? "Изменить" : KIND[p.kind].one,
    body: `${field("Название", "name", p.name, { req: true })}${field("Описание / цель", "description", p.description, { rows: 3 })}
      <div class="grid3">${field("Статус", "status", p.status, { options: Object.entries(PST).map(([k, [l]]) => [k, l]) })}${field("Приоритет", "priority", p.priority, { options: Object.entries(PPR) })}${field("Ответственный", "responsible", p.responsible || "", { options: [["", "—"], ...S.people.map((x) => [x.id, x.name])] })}</div>
      <div class="grid3">${field("Начало", "start_date", p.start_date, { type: "date" })}${field("Окончание", "end_date", p.end_date, { type: "date" })}${p.kind === "client" ? field("Клиент", "client_id", p.client_id || "", { options: [["", "—"], ...cls.map((c) => [c.id, (c.kind === "ИП" ? "ИП " : c.kind + " ") + c.name])] }) : field("Бюджет, ₽", "budget", p.budget, { type: "number" })}</div>
      ${p.kind === "client" && cts ? field("Договор", "contract_id", p.contract_id || "", { options: [["", "— без договора —"], ...cts.map((c) => [c.id, `№ ${c.number} от ${d(c.date)}`])], hint: "По договору формируются акты из приёмки работ" }) : ""}`,
    footer: `${p.id ? delHead(p.kind === "dev" ? "dev" : "projects", "pjdel") : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      el.querySelector("[data-ok]").onclick = async () => {
        const v = formData(el); if (!v.name) return toast("Укажите название", true);
        ["start_date", "end_date", "client_id", "contract_id"].forEach((k) => { if (k in v && !v[k]) v[k] = null; }); if (!v.responsible) v.responsible = null; if ("budget" in v) v.budget = v.budget || 0;
        const r = p.id ? await sb.from("projects").update(v).eq("id", p.id).select().single() : await sb.from("projects").insert({ ...v, kind: p.kind }).select().single();
        if (r.error) return toast(r.error.message, true); close(); done(r.data);
      };
      const del = el.querySelector("#pjdel"); if (del) del.onclick = async () => { close(); delProject(p); };
    },
  });
}

/** Создать клиентский проект из договора (с графиком из услуг). */
export async function projectFromContract(c, client) {
  const ex = check(await sb.from("projects").select("id").eq("contract_id", c.id));
  if (ex.length) return ex[0];
  const name = `${client.kind === "ИП" ? "ИП " : client.kind + " "}${client.name} — ${c.package_name || "внедрение"}`;
  const p = check(await sb.from("projects").insert({ kind: "client", name, client_id: client.id, contract_id: c.id, status: "active", responsible: S.profile.person_id, start_date: c.start_date || null, end_date: c.plan_end || null, budget: c.total }).select().single());
  await buildSchedule(p, c);
  return p;
}

/** График из услуг договора: этапы = категории услуг, работы = услуги, подряд; дальше правится мышкой. */
export async function buildSchedule(p, c) {
  const svc = c.services || [];
  let start = c.start_date || p.start_date || nextWorkday(today());
  if (!isWorkday(start)) start = nextWorkday(start);
  const stages = [];
  for (const s of svc) {
    const cat = S.services.find((x) => x.id === s.service_id) || S.services.find((x) => x.name === s.name);
    const days = Math.max(1, Number(s.days) || (cat && cat.days) || 5);
    const group = (cat && cat.category) || s.category || "Работы";
    let st = stages.find((x) => x.title === group); if (!st) stages.push((st = mkS(group, [])));
    st.works.push(mkW(s.name, days));
  }
  const gpr = { stages, scale: "day" };
  await saveGpr(p, gpr, start);
  return stages.reduce((a, x) => a + x.works.length, 0);
}
export async function projectPage(main, id, tab = "schedule", mode = "") {
  const p = check(await sb.from("projects").select("*").eq("id", id).single());
  const K = KIND[p.kind];
  const [cl, ct] = await Promise.all([p.client_id ? sb.from("clients").select("*").eq("id", p.client_id).single() : { data: null }, p.contract_id ? sb.from("contracts").select("*").eq("id", p.contract_id).single() : { data: null }]);
  const client = cl.data, contract = ct.data;
  const wait = leaves(p.gpr).filter((l) => l.x.state === "done").length;
  const TABS = [["schedule", "График работ"], ["tasks", "Задачи"], ...(p.kind === "client" ? [["accept", `Приёмка${wait ? ` <em class="tab-n">${wait}</em>` : ""}`]] : []), ["money", "Финансы"], ["files", "Файлы"], ["overview", "Обзор"]];
  main.innerHTML = `<a href="#/${K.path}" class="small">← ${K.title}</a>
    <div class="pj-page-head" style="margin-top:8px"><div class="tc-grad"></div><div class="in"><div class="grow" style="min-width:0"><div class="row" style="gap:10px"><h1>${esc(p.name)}</h1>${pill(p.status)}<span class="small muted">приоритет: ${PPR[p.priority]}</span></div>
      <div class="muted small" style="margin-top:4px">${client ? `<a href="#/clients/${client.id}">${esc((client.kind === "ИП" ? "ИП " : client.kind + " ") + client.name)}</a> · ` : ""}${contract ? `<a href="#/contracts/${contract.id}">договор № ${esc(contract.number)}</a> · ` : ""}Ответственный: ${esc(personName(p.responsible))}${p.start_date ? ` · ${d(p.start_date)} — ${d(p.end_date)}` : ""}</div></div>
      <div class="row">${delHead(p.kind === "dev" ? "dev" : "projects")}<button class="btn" id="ed">Настроить</button></div></div>
      <div class="tabs">${TABS.map(([k, l]) => `<a href="#/${K.path}/${id}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</div></div><div id="pb"></div>`;
  const [cls, cts] = await Promise.all([sb.from("clients").select("id,kind,name"), sb.from("contracts").select("id,number,date,client_id").order("date", { ascending: false })]).then((r) => r.map(check));
  $("#ed", main).onclick = () => projectForm(p, cls, () => projectPage(main, id, tab, mode), cts.filter((c) => !p.client_id || c.client_id === p.client_id || c.id === p.contract_id));
  const pb = $("#pb", main);
  const dp = $("#delrec", main); if (dp) dp.onclick = () => delProject(p);
  if (tab === "tasks") {
    const tp = S.ttpls.find((t) => t.id === p.template_id);
    pb.innerHTML = `<div class="row between" style="margin-bottom:8px"><span class="small muted">${tp ? `Шаблон задач: <b>${esc(tp.name)}</b>` : "Шаблон задач не применялся"}</span><button class="btn sm" id="tplb">Шаблон задач…</button></div><div id="tbx"></div>`;
    $("#tplb", pb).onclick = () => applyTemplateDialog(p, () => projectPage(main, id, "tasks"));
    return taskBoard($("#tbx", pb), { projectId: id });
  }
  if (tab === "schedule") return scheduleTab(pb, p, contract, mode);
  if (tab === "accept" && p.kind === "client") return acceptTab(pb, p, contract, client);
  if (tab === "accept") tab = "overview";
  if (tab === "money") return moneyTab(pb, p);
  if (tab === "files") return filesTab(pb, p);
  // обзор
  const [tasks, stages, money] = await Promise.all([sb.from("tasks").select("*").eq("project_id", id), sb.from("project_stages").select("*").eq("project_id", id).order("sort"), sb.from("fin_ops").select("*").eq("project_id", id)]).then((r) => r.map(check));
  const open = tasks.filter((t) => t.status !== "done"), late = open.filter((t) => t.due_at && new Date(t.due_at) < new Date());
  const inc = money.filter((m) => m.type === "in" && !m.planned).reduce((a, m) => a + Number(m.amount), 0), out = money.filter((m) => m.type === "out" && !m.planned).reduce((a, m) => a + Number(m.amount), 0);
  const curStage = stages.find((s) => !s.done);
  pb.innerHTML = `<div class="grid4">
      <div class="card kpi"><div class="small muted">Задачи</div><div class="v">${open.length}</div><div class="s">открыто, просрочено ${late.length}</div></div>
      <div class="card kpi"><div class="small muted">График</div><div class="v">${stages.filter((s) => s.done).length} / ${stages.length}</div><div class="s">${curStage ? "сейчас: " + esc(curStage.name) : "этапов нет"}</div></div>
      <div class="card kpi"><div class="small muted">Приход / расход</div><div class="v">${rub(inc)}</div><div class="s">расход ${rub(out)}</div></div>
      <div class="card kpi"><div class="small muted">Остаток</div><div class="v">${rub(inc - out)}</div><div class="s">${p.kind === "client" && contract ? "по договору " + rub(contract.total) : p.budget ? "бюджет " + rub(p.budget) : ""}</div></div></div>
    <div class="cols" style="margin-top:14px"><div class="card"><div class="sec-t">Описание</div><div style="white-space:pre-wrap">${esc(p.description) || `<span class="muted">Нет</span>`}</div></div>
      <div class="card"><div class="sec-t">Ближайшие задачи</div>${open.sort((a, b) => String(a.due_at || "9").localeCompare(String(b.due_at || "9"))).slice(0, 8).map((t) => `<div class="row between small" style="padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(t.title)}</span><span class="${t.due_at && new Date(t.due_at) < new Date() ? "late-t" : "muted"}">${t.due_at ? d(iso(new Date(t.due_at))) : ""}</span></div>`).join("") || `<span class="muted">Нет</span>`}
        <a href="#/${K.path}/${id}/tasks" class="small">Все задачи →</a></div></div>`;
}

/* ---------- финансы проекта: те же операции, что в разделе «Финансы», отобранные по проекту ---------- */
async function moneyTab(pb, p) {
  if (!can("finance", "watchAll")) { pb.innerHTML = `<div class="empty">Деньги проекта видят те, у кого в должности стоит галочка «Финансы компании».</div>`; return; }
  const [rows, R] = await Promise.all([sb.from("fin_ops").select("*").eq("project_id", p.id).order("date", { ascending: false }).then(check), loadFinRefs()]);
  const sum = (k, pl) => rows.filter((r) => r.type === k && r.planned === pl).reduce((a, r) => a + Number(r.amount), 0);
  const catName = (id) => (R.cat.find((c) => c.id === id) || {}).name || "Без статьи";
  const edit = can("finance", "edit");
  pb.innerHTML = `<div class="grid4">${[["Приход", sum("in", false)], ["Расход", sum("out", false)], ["Остаток", sum("in", false) - sum("out", false)], ["Ожидается (план)", sum("in", true) - sum("out", true)]].map(([l, v]) => `<div class="card kpi"><div class="small muted">${l}</div><div class="v">${rub(v)}</div></div>`).join("")}</div>
    <div class="row between" style="margin:14px 0 10px"><span class="small muted">Это операции из раздела «Финансы», привязанные к проекту. Оплаты по договору попадают сюда сами.</span>${edit ? `<button class="btn primary" id="nm">+ Операция</button>` : ""}</div>
    <div class="card flush">${rows.length ? `<div class="tw"><table class="t"><tr><th>Дата</th><th>Тип</th><th>Статья</th><th>Комментарий</th><th class="n">Сумма</th></tr>${rows.map((r) => `<tr class="click" data-m="${r.id}"><td>${d(r.date)}</td><td>${r.type === "in" ? `<span class="st good">приход</span>` : `<span class="st bad">расход</span>`}${r.planned ? ` <span class="st">план</span>` : ""}</td><td>${esc(catName(r.category_id))}</td><td class="small">${esc(r.comment)}</td><td class="n">${rub(r.amount)}</td></tr>`).join("")}</table></div>` : `<div class="empty" style="border:0">Операций нет</div>`}</div>`;
  const re = () => moneyTab(pb, p);
  const nm = $("#nm", pb); if (nm) nm.onclick = () => opForm({ type: "out", date: today(), project_id: p.id, contract_id: p.contract_id || undefined }, R, re);
  $$("[data-m]", pb).forEach((tr) => (tr.onclick = () => opForm(rows.find((r) => r.id === tr.dataset.m), R, re)));
}

/* ---------- файлы ---------- */
async function filesTab(pb, p) {
  const rows = check(await sb.from("project_files").select("*").eq("project_id", p.id).order("created_at", { ascending: false }));
  pb.innerHTML = `<div class="row between" style="margin-bottom:10px"><span class="small muted">Файлы хранятся в закрытом хранилище, ссылки действуют час.</span><button class="btn primary" id="up">+ Загрузить файлы</button></div>
    <div class="card flush">${rows.length ? `<div class="tw"><table class="t"><tr><th>Файл</th><th>Размер</th><th>Загружен</th><th></th></tr>${rows.map((f) => `<tr><td><button class="btn sm ghost" data-dl="${esc(f.path)}" data-name="${esc(f.name)}">${esc(f.name)}</button></td><td class="small">${Math.max(1, Math.round(f.size / 1024))} КБ</td><td class="small">${d(iso(new Date(f.created_at)))}</td><td class="n">${delBtn(p.kind === "dev" ? "dev" : "projects", `data-fdel="${f.id}"`)}</td></tr>`).join("")}</table></div>` : `<div class="empty" style="border:0">Файлов нет</div>`}</div>`;
  const re = () => filesTab(pb, p);
  $("#up", pb).onclick = () => {
    const i = document.createElement("input"); i.type = "file"; i.multiple = true;
    i.onchange = async () => {
      for (const f of i.files) {
        const ext = (f.name.split(".").pop() || "bin").replace(/[^A-Za-z0-9]/g, "");
        const path = `projects/${p.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        try { await uploadFile(path, f, f.type || "application/octet-stream"); check(await sb.from("project_files").insert({ project_id: p.id, name: f.name, path, size: f.size })); } catch (e) { toast(e.message, true); }
      }
      toast("Загружено"); re();
    };
    i.click();
  };
  $$("[data-dl]", pb).forEach((b) => (b.onclick = async () => { const { data } = await sb.storage.from("docs").createSignedUrl(b.dataset.dl, 3600, { download: b.dataset.name }); if (data) window.open(data.signedUrl, "_blank"); }));
  $$("[data-fdel]", pb).forEach((b) => (b.onclick = async () => { const f = rows.find((x) => x.id === b.dataset.fdel); if (await confirmBox(`Удалить файл «${f.name}»?`, "Удалить")) { await sb.storage.from("docs").remove([f.path]); await sb.from("project_files").delete().eq("id", f.id); re(); } }));
}
