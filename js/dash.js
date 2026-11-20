// Главная — рабочий стол по прототипу «Включи систему»: виджеты на сетке 12 колонок,
// главный — «Задачи» (период день / неделя / даты, «Срочные», вкладки по источнику, мои / команда);
// списки сделок и проектов — верх по срочным и сегодняшним задачам, однословные фильтры, «Ещё / Свернуть»;
// финансы план / факт за день / неделю / месяц; лента событий. «Настроить стол»: перетаскивание, ширина, скрыть, добавить.
import { sb, S, check, personName, autoAcceptActs } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast } from "./ui.js?v=15";
import { today, iso, addDays, workdaysUntil } from "./calendar.js?v=15";
import { can, onlyOwn } from "./access.js?v=15";
import { taskCanvas, taskForm } from "./tasks.js?v=15";
import { leaves } from "./fact.js?v=15";

const W = {
  today: { title: "Задачи", desc: "Из сделок, проектов и развития", href: "#/tasks", w: 8, see: () => can("tasks", "see") },
  deals: { title: "Сделки", desc: "С задачами, без задач, просроченные", href: "#/deals", w: 4, see: () => can("deals", "see") },
  projects: { title: "Проекты", desc: "Сроки, приёмка, просрочка", href: "#/projects", w: 4, see: () => can("projects", "see") },
  finance: { title: "Финансы", desc: "План и факт: день, неделя, месяц", href: "#/finance", w: 8, see: () => can("finance", "watchAll") },
  docs: { title: "Документы", desc: "Счета к оплате и акты на приёмке", href: "#/contracts/invoices", w: 4, see: () => can("docs", "see") || can("contracts", "see") },
  sales: { title: "План продаж", desc: "Договоры и сумма за месяц", href: "#/analytics", w: 4, see: () => can("analytics", "see") || can("contracts", "see") },
  requests: { title: "Запросы в ВС", desc: "Открытые и просроченные", href: "#/requests", w: 4, see: () => can("requests", "see") },
  feed: { title: "Лента событий", desc: "Что произошло в компании", href: "", w: 8, see: () => can("deals", "see") || can("contracts", "see") },
};
const PRESETS = {
  director: { name: "Руководитель", sub: "деньги, сделки, проекты", order: [["today", 8], ["deals", 4], ["finance", 8], ["projects", 4], ["feed", 8], ["docs", 4], ["sales", 4], ["requests", 4]] },
  sales: { name: "Продажи", sub: "сделки и касания", order: [["today", 8], ["deals", 4], ["sales", 4], ["docs", 4], ["feed", 4]] },
  pm: { name: "Проекты", sub: "работы, приёмка, запросы", order: [["today", 8], ["projects", 4], ["requests", 4], ["feed", 8]] },
};
const KEY = () => "tr_dash_v1_" + (S.profile && S.profile.person_id);
const fresh = (p = "director") => ({ preset: p, lay: Object.keys(W).map((id) => { const o = PRESETS[p].order.find((x) => x[0] === id); return { id, w: o ? o[1] : W[id].w, on: !!o }; }).sort((a, b) => idx(p, a.id) - idx(p, b.id)), period: "day", from: today(), to: addDays(today(), 7), urgent: false, src: "all", scope: S.profile.role === "owner" ? "team" : "mine", f: { deals: "today", projects: "today" }, open: {}, fin: "week" });
const idx = (p, id) => { const i = PRESETS[p].order.findIndex((x) => x[0] === id); return i < 0 ? 99 : i; };
let ST = null;
const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY())); if (s && s.lay) { Object.keys(W).forEach((id) => { if (!s.lay.some((l) => l.id === id)) s.lay.push({ id, w: W[id].w, on: false }); }); return s; } } catch (e) {} return fresh(S.profile.role === "owner" ? "director" : "pm"); };
const save = () => { try { localStorage.setItem(KEY(), JSON.stringify(ST)); } catch (e) {} };

const DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return n + " " + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c); };
const dueD = (t) => (t.due_at ? iso(new Date(t.due_at)) : null);
const hhmm = (t) => { const x = new Date(t.due_at); return x.getHours() || x.getMinutes() ? x.toTimeString().slice(0, 5) : ""; };
const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

export async function dashboard(main) {
  ST = ST || load();
  await autoAcceptActs();
  const q = (p) => p.then((r) => (r.error ? [] : r.data));
  const [tasks, deals, stages, projects, ops, invs, acts, reqs, cs, cls, dev, cev] = await Promise.all([
    q(sb.from("tasks").select("*").order("due_at", { ascending: true, nullsFirst: false })),
    q(sb.from("deals").select("id,title,stage_id,pipeline_id,responsible,amount,created_at,fields")),
    q(sb.from("stages").select("id,name,kind,color,pipeline_id")),
    q(sb.from("projects").select("id,name,kind,status,responsible,end_date,start_date,gpr")),
    can("finance", "watchAll") ? q(sb.from("fin_ops").select("date,type,amount,planned,comment,category_id")) : [],
    q(sb.from("invoices").select("*").in("status", ["issued", "overdue"])),
    q(sb.from("acts").select("*").in("status", ["sent", "accepted_default"])),
    q(sb.from("vs_requests").select("*").in("status", ["sent", "work"])),
    q(sb.from("contracts").select("id,number,status,client_id,total,date")),
    q(sb.from("clients").select("id,kind,name")),
    q(sb.from("deal_events").select("*").order("at", { ascending: false }).limit(30)),
    q(sb.from("contract_events").select("*").order("at", { ascending: false }).limit(30)),
  ]);
  const D = { tasks, deals, stages, projects, ops, invs, acts, reqs, cs, cls, dev, cev };
  const me = S.profile.person_id, t0 = today();
  const now = new Date();
  const re = () => dashboard(main);
  let editing = main.dataset.edit === "1";

  /* ---------- задачи ---------- */
  const srcOf = (t) => (t.deal_id ? "deal" : t.project_id ? ((projects.find((p) => p.id === t.project_id) || {}).kind === "dev" ? "dev" : "project") : "none");
  const SRC = { deal: "Сделки", project: "Проекты", dev: "Развитие", none: "Без привязки" };
  const parent = (t) => (t.deal_id ? (deals.find((x) => x.id === t.deal_id) || {}).title : t.project_id ? (projects.find((x) => x.id === t.project_id) || {}).name : "") || "";
  const inScope = (t) => (ST.scope === "team" && !onlyOwn("tasks")) || t.assignee === me;
  const late = (t) => t.status !== "done" && t.due_at && new Date(t.due_at) < now;
  const range = () => (ST.period === "day" ? [t0, t0] : ST.period === "week" ? [t0, addDays(t0, 6)] : [ST.from, ST.to]);
  const urgent = (t) => late(t) || dueD(t) === t0 || t.urgent || t.priority === "high";
  const taskRows = () => {
    const [a, b] = range();
    return tasks.filter((t) => inScope(t) && (t.status !== "done" ? (late(t) || (dueD(t) && dueD(t) >= a && dueD(t) <= b)) : t.done_at && iso(new Date(t.done_at)) >= a && iso(new Date(t.done_at)) <= b) && (!ST.urgent || urgent(t)));
  };
  const wToday = () => {
    const all = taskRows(), list = all.filter((t) => ST.src === "all" || srcOf(t) === ST.src);
    const open = list.filter((t) => t.status !== "done"), done = list.filter((t) => t.status === "done");
    const groups = [["Просрочено", open.filter(late)], ...Object.entries(SRC).map(([k, l]) => [l, open.filter((t) => !late(t) && srcOf(t) === k)]), ["Выполнено", done]].filter((g) => g[1].length);
    const row = (t) => { const lt = late(t), dd = dueD(t); const when = !dd ? "без срока" : lt ? (dd === addDays(t0, -1) ? "вчера" : `${Math.max(1, Math.round((new Date(t0) - new Date(dd)) / 864e5))} дн. назад`) : dd === t0 ? hhmm(t) || "сегодня" : dd === addDays(t0, 1) ? "завтра" : `${+dd.slice(8)} ${MON[+dd.slice(5, 7) - 1]}`;
      return `<div class="wt${t.status === "done" ? " done" : ""}" data-task="${t.id}"><input type="checkbox" data-tdone="${t.id}"${t.status === "done" ? " checked" : ""} aria-label="Выполнено">
        <div class="wt-m"><div class="wt-t">${t.priority === "high" && t.status !== "done" ? `<b class="wt-pr">!!</b> ` : ""}${esc(t.title)}</div>${parent(t) ? `<div class="wt-p">${esc(SRC[srcOf(t)])}: ${esc(parent(t))}</div>` : ""}</div>
        <span class="wt-d${lt ? " over" : ""}">${esc(when)}</span><span class="tk-ava" title="${esc(personName(t.assignee))}">${esc(initials(personName(t.assignee)))}</span></div>`; };
    const cnt = (k) => all.filter((t) => t.status !== "done" && (k === "all" || srcOf(t) === k)).length;
    const [a, b] = range();
    return `<div class="wtb">
        <div class="seg sm">${[["day", "День"], ["week", "Неделя"], ["dates", "Даты"]].map(([k, l]) => `<button data-per="${k}" class="${ST.period === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${ST.period === "dates" ? `<input type="date" data-from value="${ST.from}"><input type="date" data-to value="${ST.to}">` : `<span class="small muted">${ST.period === "day" ? cap(DAYS[now.getDay()]) + ", " + now.getDate() + " " + MON[now.getMonth()] : d(a).slice(0, 5) + " — " + d(b).slice(0, 5)}</span>`}
        <span class="grow"></span>
        <label class="wsw"><input type="checkbox" data-urg${ST.urgent ? " checked" : ""}><i></i>Срочные</label>
        ${onlyOwn("tasks") ? "" : `<div class="seg sm">${[["mine", "Мои"], ["team", "Команда"]].map(([k, l]) => `<button data-scope="${k}" class="${ST.scope === k ? "on" : ""}">${l}</button>`).join("")}</div>`}
        <button class="btn sm" data-tadd>+ Задача</button></div>
      <div class="wtabs">${[["all", "Все"], ...Object.entries(SRC)].map(([k, l]) => `<button data-src="${k}" class="${ST.src === k ? "on" : ""}">${l}<em>${cnt(k)}</em></button>`).join("")}</div>
      <div class="wt-list">${groups.length ? groups.map(([h, g]) => `<div class="wt-g${h === "Просрочено" ? " over" : ""}">${h}<em>${g.length}</em></div>${g.map(row).join("")}`).join("") : `<div class="w-empty">${ST.urgent ? "Срочных задач нет" : "На этот период задач нет"} 🎉</div>`}</div>`;
  };

  /* ---------- сделки и проекты: верх по срочности ---------- */
  const tStat = (key, id) => { const ts = tasks.filter((t) => t[key] === id && t.status !== "done" && inScope(t)); return { all: ts.length, today: ts.filter((t) => dueD(t) === t0).length, over: ts.filter(late).length }; };
  const listWidget = (k, items, FIL, rowFn) => {
    const f = FIL.find((x) => x[0] === ST.f[k]) || FIL[0], list = items.filter(f[2]).sort((a, b) => b._s.over * 100 + b._s.today * 10 - (a._s.over * 100 + a._s.today * 10));
    const open = ST.open[k], shown = open ? list : list.slice(0, 3);
    return `<div class="wf">${FIL.map(([fk, l, fn]) => `<button data-f="${k}:${fk}" class="${f[0] === fk ? "on" : ""}">${l} <em>${items.filter(fn).length}</em></button>`).join("")}</div>
      <div class="wl">${shown.map(rowFn).join("") || `<div class="w-empty">Пусто</div>`}</div>
      ${list.length > 3 ? `<button class="w-more" data-more="${k}">${open ? "Свернуть" : `Ещё ${list.length - 3}`}</button>` : ""}`;
  };
  const stOf = (id) => stages.find((s) => s.id === id) || {};
  const wDeals = () => {
    const mine = onlyOwn("deals") ? deals.filter((x) => x.responsible === me) : deals;
    const items = mine.filter((x) => stOf(x.stage_id).kind === "open").map((x) => ({ ...x, _s: tStat("deal_id", x.id) }));
    const FIL = [["today", "Сегодня", (x) => x._s.today > 0], ["over", "Просрочено", (x) => x._s.over > 0], ["idle", "Без задач", (x) => !x._s.all], ["new", "Новые", (x) => iso(new Date(x.created_at)) >= addDays(t0, -7)]];
    return listWidget("deals", items, FIL, (x) => `<a class="wl-r" href="#/deals/${x.pipeline_id}" data-deal="${x.id}"><i style="background:${esc(stOf(x.stage_id).color || "#999")}"></i><div class="wl-m"><b>${esc(x.title)}</b><span>${esc(stOf(x.stage_id).name || "")}${Number(x.amount) && can("dashboard", "money") ? " · " + rub(x.amount) : ""}</span></div>${badges(x._s)}</a>`);
  };
  const wProjects = () => {
    const mine = onlyOwn("projects") ? projects.filter((p) => p.responsible === me) : projects;
    const items = mine.filter((p) => p.kind === "client" && !["done", "cancelled"].includes(p.status)).map((p) => { const L = leaves(p.gpr), wait = L.filter((l) => l.x.state === "done").length, ready = L.length ? Math.round((L.filter((l) => ["done", "accepted"].includes(l.x.state)).length / L.length) * 100) : 0; return { ...p, _s: tStat("project_id", p.id), wait, ready, lateEnd: p.end_date && p.end_date < t0 }; });
    const FIL = [["today", "Сегодня", (x) => x._s.today > 0], ["over", "Просрочено", (x) => x._s.over > 0 || x.lateEnd], ["accept", "Приёмка", (x) => x.wait > 0], ["all", "Все", () => true]];
    return listWidget("projects", items, FIL, (x) => `<a class="wl-r" href="#/projects/${x.id}${x.wait ? "/accept" : ""}"><i style="background:${x.lateEnd ? "var(--bad)" : x.status === "planned" ? "var(--orange)" : "var(--accent)"}"></i><div class="wl-m"><b>${esc(x.name)}</b><span>готово ${x.ready}%${x.end_date ? " · до " + d(x.end_date).slice(0, 5) : ""}${x.wait ? ` · <span style="color:var(--info)">ждут приёмки ${x.wait}</span>` : ""}</span></div>${badges(x._s)}</a>`);
  };
  const badges = (s) => `<span class="wl-b">${s.over ? `<em class="over">${s.over}</em>` : ""}${s.today ? `<em class="today">${s.today}</em>` : ""}${!s.all ? `<em class="idle">нет задач</em>` : ""}</span>`;

  /* ---------- финансы ---------- */
  const wFinance = () => {
    const [a, b] = ST.fin === "day" ? [t0, t0] : ST.fin === "week" ? [t0, addDays(t0, 6)] : [t0.slice(0, 8) + "01", iso(new Date(+t0.slice(0, 4), +t0.slice(5, 7), 0))];
    const inP = (x) => x >= a && x <= b, sum = (f) => ops.filter(f).reduce((s, o) => s + Number(o.amount), 0);
    const fIn = sum((o) => !o.planned && o.type === "in" && inP(o.date)), fOut = sum((o) => !o.planned && o.type === "out" && inP(o.date));
    const invP = invs.filter((i) => inP(i.due_date && i.due_date >= t0 ? i.due_date : t0)).reduce((s, i) => s + Number(i.amount), 0);
    const pIn = sum((o) => o.planned && o.type === "in" && inP(o.date < t0 ? t0 : o.date)) + invP, pOut = sum((o) => o.planned && o.type === "out" && inP(o.date < t0 ? t0 : o.date));
    const bar = (f, p, cls) => `<div class="wfin-b"><i class="${cls}" style="width:${p || f ? Math.min(100, (f / Math.max(f, p)) * 100) : 0}%"></i></div>`;
    const near = [...ops.filter((o) => o.planned && o.date <= b).map((o) => ({ date: o.date < t0 ? t0 : o.date, amt: o.type === "in" ? +o.amount : -o.amount, label: o.comment || "плановая операция" })), ...invs.map((i) => ({ date: !i.due_date || i.due_date < t0 ? t0 : i.due_date, amt: +i.amount, label: "Счёт № " + i.number }))].filter((x) => x.date <= b).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 5);
    return `<div class="wtb"><div class="seg sm">${[["day", "День"], ["week", "Неделя"], ["month", "Месяц"]].map(([k, l]) => `<button data-fin="${k}" class="${ST.fin === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="wfin"><div><span>Поступления</span><b class="pos">${rub(fIn)}</b><small>план ${rub(pIn)}</small>${bar(fIn, pIn, "in")}</div>
        <div><span>Расходы</span><b class="neg">${rub(fOut)}</b><small>план ${rub(pOut)}</small>${bar(fOut, pOut, "out")}</div>
        <div><span>Итог</span><b class="${fIn - fOut < 0 ? "neg" : ""}">${rub(fIn - fOut)}</b><small>по плану ${rub(pIn - pOut)}</small></div></div>
      ${near.length ? `<div class="sec-t" style="margin:12px 0 6px">Ожидается</div>${near.map((x) => `<div class="wl-line"><span class="muted">${d(x.date).slice(0, 5)}</span><span class="grow">${esc(x.label)}</span><b class="${x.amt < 0 ? "neg" : "pos"}">${x.amt < 0 ? "−" : "+"}${rub(Math.abs(x.amt))}</b></div>`).join("")}` : `<div class="w-empty">Плановых платежей нет</div>`}`;
  };
  /* ---------- документы, план продаж, запросы, лента ---------- */
  const cname = (cid) => { const c = cs.find((x) => x.id === cid), cl = c && cls.find((x) => x.id === c.client_id); return cl ? (cl.kind === "ИП" ? "ИП " : cl.kind + " ") + cl.name : ""; };
  const M = can("dashboard", "money");
  const wDocs = () => {
    const ov = invs.filter((i) => i.due_date && i.due_date < t0), soon = acts.filter((a) => a.status === "sent" && a.deadline && workdaysUntil(a.deadline) <= 2), def = acts.filter((a) => a.status === "accepted_default");
    const rows = [...ov.map((i) => [`#/contracts/${i.contract_id}`, `Счёт № ${i.number}`, cname(i.contract_id), `просрочен с ${d(i.due_date).slice(0, 5)}`, "over"]), ...invs.filter((i) => !ov.includes(i)).map((i) => [`#/contracts/${i.contract_id}`, `Счёт № ${i.number}`, cname(i.contract_id), `оплата до ${d(i.due_date).slice(0, 5)}`, ""]),
      ...soon.map((a) => [`#/contracts/${a.contract_id}`, `Акт № ${a.number}`, cname(a.contract_id), `приёмка до ${d(a.deadline).slice(0, 5)}`, "today"]), ...def.map((a) => [`#/contracts/${a.contract_id}`, `Акт № ${a.number}`, cname(a.contract_id), "принят по умолчанию — подпишите", "today"])];
    return `<div class="wkpi"><div><b>${M ? rub(invs.reduce((s, i) => s + +i.amount, 0)) : invs.length}</b><span>${M ? `к оплате, ${invs.length} сч.` : "счетов к оплате"}</span></div><div><b class="${ov.length ? "neg" : ""}">${ov.length}</b><span>просрочено</span></div><div><b>${acts.filter((a) => a.status === "sent").length}</b><span>актов на приёмке</span></div></div>
      <div class="wl">${rows.slice(0, 5).map(([h, a, b2, c, cl]) => `<a class="wl-r" href="${h}"><div class="wl-m"><b>${esc(a)}</b><span>${esc(b2)}</span></div><span class="wl-s ${cl}">${esc(c)}</span></a>`).join("") || `<div class="w-empty">Ничего не ждёт</div>`}</div>`;
  };
  const wSales = () => {
    const o = S.settings.options || {}, pn = Number(o.plan_contracts) || 2, ps = Number(o.plan_amount) || 100000, mk = t0.slice(0, 7);
    const mc = cs.filter((c) => !["draft", "terminated"].includes(c.status) && String(c.date).slice(0, 7) === mk), sum = mc.reduce((s, c) => s + +c.total, 0);
    const openD = deals.filter((x) => stOf(x.stage_id).kind === "open").length;
    return `<div class="wsale"><div><span>Договоры</span><b>${mc.length} <small>из ${pn}</small></b><div class="bar"><i style="width:${Math.min(100, (mc.length / pn) * 100)}%"></i></div></div>
      ${M ? `<div><span>Сумма</span><b>${rub(sum)} <small>из ${rub(ps)}</small></b><div class="bar"><i style="width:${Math.min(100, (sum / ps) * 100)}%"></i></div></div>` : ""}
      <div class="small muted">В работе сделок: ${openD}. ${new Date().getDate() > 20 && mc.length < pn ? "До конца месяца меньше 10 дней." : ""}</div></div>`;
  };
  const wReq = () => { const lt = reqs.filter((r) => r.promised_date && r.promised_date < t0);
    return `<div class="wkpi"><div><b>${reqs.length}</b><span>открыто</span></div><div><b class="${lt.length ? "neg" : ""}">${lt.length}</b><span>просрочено</span></div><div><b>${reqs.filter((r) => r.blocking).length}</b><span>блокируют</span></div></div>
      <div class="wl">${reqs.slice().sort((a, b) => (b.blocking - a.blocking) || String(a.promised_date || "9").localeCompare(String(b.promised_date || "9"))).slice(0, 4).map((r) => `<a class="wl-r" href="#/requests"><div class="wl-m"><b>${esc(r.summary)}</b><span>${esc(r.module || "без модуля")}</span></div><span class="wl-s ${r.promised_date && r.promised_date < t0 ? "over" : ""}">${r.promised_date ? "к " + d(r.promised_date).slice(0, 5) : "без срока"}</span></a>`).join("") || `<div class="w-empty">Открытых запросов нет</div>`}</div>`; };
  const wFeed = () => {
    const ev = [...dev.map((e) => ({ at: e.at, who: e.user_name, text: e.text, href: (() => { const dl = deals.find((x) => x.id === e.deal_id); return dl ? `#/deals/${dl.pipeline_id}` : ""; })(), where: (deals.find((x) => x.id === e.deal_id) || {}).title })), ...cev.filter((e) => cs.some((c) => c.id === e.contract_id)).map((e) => ({ at: e.at, who: e.user_name, text: e.text, href: `#/contracts/${e.contract_id}`, where: "Договор № " + ((cs.find((c) => c.id === e.contract_id) || {}).number || "") }))].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
    const when = (s) => { const x = new Date(s), dd = iso(x); return dd === t0 ? x.toTimeString().slice(0, 5) : dd === addDays(t0, -1) ? "вчера" : d(dd).slice(0, 5); };
    return ev.length ? `<div class="wfeed">${ev.map((e) => `<a ${e.href ? `href="${e.href}"` : ""}><time>${when(e.at)}</time><span><b>${esc(e.who || "Система")}</b> ${esc(e.text)}${e.where ? ` <em>· ${esc(e.where)}</em>` : ""}</span></a>`).join("")}</div>` : `<div class="w-empty">Событий пока нет</div>`;
  };
  const R = { today: wToday, deals: wDeals, projects: wProjects, finance: wFinance, docs: wDocs, sales: wSales, requests: wReq, feed: wFeed };
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  /* ---------- раскладка ---------- */
  const vis = ST.lay.filter((l) => l.on && W[l.id] && W[l.id].see());
  const shelf = ST.lay.filter((l) => !l.on && W[l.id] && W[l.id].see());
  const hello = () => { const h = now.getHours(); return (h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер") + ", " + esc(String(S.profile.name || "").split(/\s+/)[0]); };
  const myOpen = tasks.filter((t) => t.assignee === me && t.status !== "done"), myLate = myOpen.filter(late), myToday = myOpen.filter((t) => dueD(t) === t0);
  main.innerHTML = `<div class="dash-head"><div><h1>${hello()}</h1><div class="small muted">${cap(DAYS[now.getDay()])}, ${now.getDate()} ${MON[now.getMonth()]} · у вас ${plural(myToday.length, "задача", "задачи", "задач")} на сегодня${myLate.length ? `, <span style="color:var(--bad)">${myLate.length} просрочено</span>` : ""}</div></div>
      <div class="row">${editing ? `<div class="dash-pre">${Object.entries(PRESETS).map(([k, p]) => `<button data-pre="${k}" title="${esc(p.sub)}" class="${ST.preset === k ? "on" : ""}">${p.name}</button>`).join("")}</div><button class="btn primary" data-edit>Готово</button>` : `<button class="btn" data-edit>⚙ Настроить стол</button>${can("contracts", "create") ? `<a class="btn grad" href="#/contracts/new">+ Договор</a>` : ""}`}</div></div>
    ${editing ? `<div class="dash-note">Перетаскивайте виджеты за заголовок, ширину меняйте кнопками ◧ ◨, ✕ — убрать. ${shelf.length ? "Убранные — на полке ниже." : ""}</div>` : ""}
    <div class="dash${editing ? " editing" : ""}">${vis.map((l) => `<section class="w" data-w="${l.id}" style="--span:${l.w}" ${editing ? 'draggable="true"' : ""}>
        <header><div><h3>${W[l.id].title}</h3>${editing ? `<small>${W[l.id].desc}</small>` : ""}</div>
          ${editing ? `<div class="w-ed"><button data-wd="${l.id}:-1" title="Уже">◧</button><span>${l.w}/12</span><button data-wd="${l.id}:1" title="Шире">◨</button><button data-hide="${l.id}" title="Убрать">✕</button></div>` : W[l.id].href ? `<a class="w-go" href="${W[l.id].href}" title="Открыть раздел">→</a>` : ""}</header>
        <div class="w-b">${R[l.id]()}</div></section>`).join("")}</div>
    ${editing && shelf.length ? `<div class="dash-shelf"><div class="sec-t">Добавить на стол</div><div class="row">${shelf.map((l) => `<button class="dash-add" data-show="${l.id}"><b>+ ${W[l.id].title}</b><span>${W[l.id].desc}</span></button>`).join("")}</div></div>` : ""}`;

  /* ---------- события ---------- */
  const set = (fn) => { fn(); save(); re(); };
  $$("[data-edit]", main).forEach((b) => (b.onclick = () => { main.dataset.edit = editing ? "" : "1"; re(); }));
  $$("[data-pre]", main).forEach((b) => (b.onclick = () => set(() => { const k = b.dataset.pre, keep = { ...ST }; ST = { ...fresh(k), scope: keep.scope, f: keep.f }; })));
  $$("[data-wd]", main).forEach((b) => (b.onclick = () => set(() => { const [id, dv] = b.dataset.wd.split(":"), l = ST.lay.find((x) => x.id === id), steps = [4, 6, 8, 12], i = steps.indexOf(l.w); l.w = steps[Math.max(0, Math.min(3, (i < 0 ? 0 : i) + +dv))]; })));
  $$("[data-hide]", main).forEach((b) => (b.onclick = () => set(() => (ST.lay.find((x) => x.id === b.dataset.hide).on = false))));
  $$("[data-show]", main).forEach((b) => (b.onclick = () => set(() => { const l = ST.lay.find((x) => x.id === b.dataset.show); l.on = true; ST.lay = [...ST.lay.filter((x) => x !== l), l]; })));
  if (editing) {
    $$("[data-w]", main).forEach((el) => {
      el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", el.dataset.w); el.classList.add("drag"); };
      el.ondragend = () => el.classList.remove("drag");
      el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
      el.ondragleave = () => el.classList.remove("over");
      el.ondrop = (e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/plain"), to = el.dataset.w; if (from === to) return; set(() => { const a = ST.lay.findIndex((x) => x.id === from), item = ST.lay.splice(a, 1)[0], b = ST.lay.findIndex((x) => x.id === to); ST.lay.splice(b, 0, item); }); };
    });
    return;
  }
  $$("[data-per]", main).forEach((b) => (b.onclick = () => set(() => (ST.period = b.dataset.per))));
  const fr = $("[data-from]", main); if (fr) { fr.onchange = () => set(() => (ST.from = fr.value || ST.from)); $("[data-to]", main).onchange = (e) => set(() => (ST.to = e.target.value || ST.to)); }
  const ug = $("[data-urg]", main); if (ug) ug.onchange = () => set(() => (ST.urgent = ug.checked));
  $$("[data-scope]", main).forEach((b) => (b.onclick = () => set(() => (ST.scope = b.dataset.scope))));
  $$("[data-src]", main).forEach((b) => (b.onclick = () => set(() => (ST.src = b.dataset.src))));
  $$("[data-f]", main).forEach((b) => (b.onclick = () => set(() => { const [k, v] = b.dataset.f.split(":"); ST.f[k] = v; ST.open[k] = false; })));
  $$("[data-more]", main).forEach((b) => (b.onclick = () => set(() => (ST.open[b.dataset.more] = !ST.open[b.dataset.more]))));
  $$("[data-fin]", main).forEach((b) => (b.onclick = () => set(() => (ST.fin = b.dataset.fin))));
  const ta = $("[data-tadd]", main); if (ta) ta.onclick = () => taskForm({ assignee: me, due_at: new Date(`${t0}T18:00:00`).toISOString() }, re, projects);
  $$("[data-tdone]", main).forEach((cb) => (cb.onclick = (e) => e.stopPropagation(), cb.onchange = async () => { const r = await sb.from("tasks").update({ status: cb.checked ? "done" : "todo", done_at: cb.checked ? new Date().toISOString() : null }).eq("id", cb.dataset.tdone); if (r.error) return toast(r.error.message, true); if (cb.checked) toast("Задача выполнена"); re(); }));
  $$("[data-task]", main).forEach((el) => (el.onclick = (e) => { if (e.target.closest("input")) return; taskCanvas(tasks.find((t) => t.id === el.dataset.task), re, projects, deals); }));
}
