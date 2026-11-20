// Задачник в логике «Включи систему»: плитки задач, виды Канбан / Эйзенхауэра / Список / Календарь, карточка задачи.
import { sb, S, check, personName, uploadFile } from "./db.js?v=15";
import { esc, d, $, $$, toast, modal, confirmBox, field, formData } from "./ui.js?v=15";
import { today, iso, addDays } from "./calendar.js?v=15";
import { onlyOwn, can } from "./access.js?v=15";
import { delRec } from "./del.js?v=15";

const ST = { todo: "К выполнению", doing: "В работе", done: "Готово" };
const ST_COLOR = { todo: "#8d8a83", doing: "#ff9a1f", done: "#1d7f55" };
const PR = { high: ["Высокий", "bad", "!!"], medium: ["Средний", "info", "!"], low: ["Низкий", "", "·"] };
const VIEWS = [["kanban", "Канбан"], ["matrix", "Эйзенхауэра"], ["list", "Список"], ["calendar", "Календарь"]];
const HEADERS = { contact: "📞 Связаться", meeting: "👥 Встреча", video: "🎥 Видеосвязь" };
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("tr_" + k); localStorage.setItem("tr_" + k, v); } catch (e) { return null; } };

const dueDate = (t) => (t.due_at ? iso(new Date(t.due_at)) : null);
const dueTime = (t) => { if (!t.due_at) return ""; const x = new Date(t.due_at); const h = x.getHours(), m = x.getMinutes(); return h === 0 && m === 0 ? "" : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
const isOverdue = (t) => t.status !== "done" && t.due_at && new Date(t.due_at) < new Date();
const urgentOf = (t) => t.urgent || (t.status !== "done" && t.due_at && dueDate(t) <= addDays(today(), 1));
const importantOf = (t) => t.important || t.priority === "high";
const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
function dueLabel(t) {
  if (!t.due_at) return { text: "", cls: "" };
  const dd = dueDate(t), td = today(), tm = dueTime(t);
  let text;
  if (dd === td) text = "Сегодня"; else if (dd === addDays(td, 1)) text = "Завтра"; else if (dd === addDays(td, -1)) text = "Вчера";
  else text = new Date(t.due_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return { text: text + (tm ? " " + tm : ""), cls: t.status === "done" ? "" : isOverdue(t) ? "is-late" : dd === td ? "is-today" : "" };
}

/** Плитка задачи (как task-card во «Включи систему»). */
function tile(t, where, opts = {}) {
  const dl = dueLabel(t), done = t.status === "done";
  return `<div class="tk${done ? " is-done" : ""}${isOverdue(t) ? " is-late" : ""}${opts.list ? " is-list" : ""}" data-t="${t.id}" draggable="true">
    <div class="tk-title">${done ? "" : `<span class="tk-pr pr-${t.priority}" title="Приоритет: ${PR[t.priority][0]}">${PR[t.priority][2]}</span>`}${t.header && HEADERS[t.header] ? `<b>${HEADERS[t.header]}:</b> ` : ""}${esc(t.title)}</div>
    ${t.description && !opts.list ? `<div class="tk-desc">${esc(t.description)}</div>` : ""}
    <div class="tk-foot"><label class="tk-check" title="${done ? "Вернуть в работу" : "Выполнить"}"><input type="checkbox" data-done="${t.id}"${done ? " checked" : ""}></label>
      ${dl.text ? `<span class="tk-due ${dl.cls}">🕑 ${esc(dl.text)}</span>` : `<span class="tk-due muted">без срока</span>`}
      <span class="grow"></span>${where ? `<span class="tk-where" title="${esc(where)}">${esc(where)}</span>` : ""}${t.auto ? `<span class="tk-auto" title="Поставлена автоматически">авто</span>` : ""}
      <span class="tk-ava" title="${esc(personName(t.assignee))}">${esc(initials(personName(t.assignee)))}</span>${can("tasks", "delete") ? `<button class="tk-del" data-tdel="${t.id}" title="Удалить задачу" aria-label="Удалить задачу">🗑</button>` : ""}</div></div>`;
}

/**
 * Задачник внутри элемента.
 * opts: { scope: 'all'|'client'|'dev'|'deals'|'general', projectId, dealId }
 */
export async function taskBoard(root, opts = {}) {
  const st = { view: VIEWS.some((v) => v[0] === pref("view")) ? pref("view") : "kanban", q: "", assignee: "", status: "open", prio: "", due: "", project: "", month: today().slice(0, 7) };
  if (opts.projectId || opts.dealId) st.status = "all";
  let tasks = [], projects = [], deals = [];
  const load = async () => {
    let q = sb.from("tasks").select("*").order("due_at", { ascending: true, nullsFirst: false });
    if (opts.projectId) q = q.eq("project_id", opts.projectId);
    if (opts.dealId) q = q.eq("deal_id", opts.dealId);
    if (onlyOwn("tasks")) q = q.eq("assignee", S.profile.person_id);
    const [t, p, dl] = await Promise.all([q, sb.from("projects").select("id,name,kind"), sb.from("deals").select("id,title")]);
    tasks = check(t); projects = check(p); deals = check(dl);
    const kindOf = (x) => (projects.find((p) => p.id === x.project_id) || {}).kind;
    if (opts.scope === "client") tasks = tasks.filter((x) => x.project_id && kindOf(x) === "client");
    if (opts.scope === "dev") tasks = tasks.filter((x) => x.project_id && kindOf(x) === "dev");
    if (opts.scope === "deals") tasks = tasks.filter((x) => x.deal_id);
    if (opts.scope === "general") tasks = tasks.filter((x) => !x.project_id && !x.deal_id);
  };
  const where = (t) => {
    if (opts.projectId || opts.dealId) return "";
    if (t.project_id) { const p = projects.find((x) => x.id === t.project_id); return p ? p.name : ""; }
    if (t.deal_id) { const dl = deals.find((x) => x.id === t.deal_id); return dl ? "Сделка: " + (dl.title || "без названия") : ""; }
    return "";
  };
  const filtered = () => tasks.filter((t) => {
    if (st.q && !(t.title + " " + t.description).toLowerCase().includes(st.q.toLowerCase())) return false;
    if (st.assignee === "me" ? t.assignee !== S.profile.person_id : st.assignee && t.assignee !== st.assignee) return false;
    if (st.status === "open" && t.status === "done") return false;
    if (st.status && !["open", "all"].includes(st.status) && t.status !== st.status) return false;
    if (st.prio && t.priority !== st.prio) return false;
    if (st.project && t.project_id !== st.project) return false;
    const dd = dueDate(t), td = today();
    if (st.due === "overdue" && !isOverdue(t)) return false;
    if (st.due === "today" && dd !== td) return false;
    if (st.due === "week" && !(dd && dd >= td && dd <= addDays(td, 7))) return false;
    if (st.due === "none" && dd) return false;
    return true;
  });

  const viewKanban = (list) => `<div class="tkb">${Object.entries(ST).map(([k, l]) => { const col = list.filter((t) => t.status === k);
    return `<div class="tkb-col" data-drop="${k}"><div class="dk-h"><div class="dk-ht">${l}</div><div class="dk-sub">${col.length} ${col.length % 10 === 1 && col.length % 100 !== 11 ? "задача" : [2, 3, 4].includes(col.length % 10) && ![12, 13, 14].includes(col.length % 100) ? "задачи" : "задач"}</div><div class="dk-line" style="background:${ST_COLOR[k]}"></div></div>
      ${k === "todo" ? `<button class="btn sm ghost w100 dk-add" data-quick>+ Задача</button>` : ""}<div class="tkb-list">${col.map((t) => tile(t, where(t))).join("") || `<div class="dk-empty">Перетащите задачу сюда</div>`}</div></div>`; }).join("")}</div>`;

  const viewMatrix = (list) => {
    const Q = [["q1", "Важно и срочно", "Сделать сейчас", (t) => importantOf(t) && urgentOf(t)], ["q2", "Важно, не срочно", "Запланировать", (t) => importantOf(t) && !urgentOf(t)], ["q3", "Срочно, не важно", "Делегировать", (t) => !importantOf(t) && urgentOf(t)], ["q4", "Не срочно и не важно", "Отложить или убрать", (t) => !importantOf(t) && !urgentOf(t)]];
    return `<div class="eis">${Q.map(([c, h, s, f]) => { const col = list.filter((t) => t.status !== "done" && f(t)); return `<section class="eis-q ${c}" data-q="${c}"><header><b>${h}</b><span>${s}</span><em>${col.length}</em></header><div class="eis-body">${col.map((t) => tile(t, where(t))).join("") || `<div class="eis-empty">Пусто — перетащите задачу сюда</div>`}</div></section>`; }).join("")}</div>
      <div class="small muted" style="margin-top:6px">Важное — отметка «важно» или высокий приоритет. Срочное — отметка «срочно» или срок сегодня, завтра, просрочен. Перетащите задачу в другой квадрат — отметки поменяются. Если задачи не помещаются, квадрат листается вправо.</div>`;
  };

  const viewList = (list) => {
    const td = today(), G = [["Просрочено", (t) => isOverdue(t)], ["Сегодня", (t) => !isOverdue(t) && dueDate(t) === td], ["Завтра", (t) => dueDate(t) === addDays(td, 1)], ["На этой неделе", (t) => dueDate(t) > addDays(td, 1) && dueDate(t) <= addDays(td, 7)], ["Позже", (t) => dueDate(t) > addDays(td, 7)], ["Без срока", (t) => !t.due_at && t.status !== "done"], ["Выполнено", (t) => t.status === "done"]];
    const used = new Set();
    const groups = G.map(([h, f]) => { const g = list.filter((t) => !used.has(t.id) && (h === "Выполнено" ? t.status === "done" : t.status !== "done" && f(t))); g.forEach((t) => used.add(t.id)); return [h, g]; }).filter(([, g]) => g.length);
    return groups.length ? groups.map(([h, g]) => `<div class="tl-g"><div class="tl-h${h === "Просрочено" ? " late" : ""}">${h} <span>${g.length}</span></div><div class="tl-list">${g.map((t) => tile(t, where(t), { list: true })).join("")}</div></div>`).join("") : `<div class="empty">Задач нет</div>`;
  };

  const viewCalendar = (list) => {
    const [y, m] = st.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const days = []; for (let i = 0; i < 42; i++) { const x = new Date(start); x.setDate(start.getDate() + i); days.push(iso(x)); }
    const noDue = list.filter((t) => !t.due_at);
    return `<div class="row" style="margin-bottom:8px"><button class="btn sm" data-mon="-1">←</button><b style="min-width:150px;text-align:center">${first.toLocaleString("ru-RU", { month: "long", year: "numeric" })}</b><button class="btn sm" data-mon="1">→</button><button class="btn sm ghost" data-mon="0">Сегодня</button></div>
      <div class="cal">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((x) => `<div class="cal-h">${x}</div>`).join("")}
      ${days.map((ds) => { const items = list.filter((t) => dueDate(t) === ds); return `<div class="cal-d${ds.slice(0, 7) !== st.month ? " other" : ""}${ds === today() ? " now" : ""}" data-day="${ds}"><div class="cal-n">${Number(ds.slice(8))}</div>${items.slice(0, 4).map((t) => `<div class="cal-t${t.status === "done" ? " done" : ""}${isOverdue(t) ? " late" : ""}" data-t="${t.id}" draggable="true">${dueTime(t) ? dueTime(t) + " " : ""}${esc(t.title)}</div>`).join("")}${items.length > 4 ? `<div class="small muted">ещё ${items.length - 4}</div>` : ""}</div>`; }).join("")}</div>
      ${noDue.length ? `<div class="card" style="margin-top:10px"><div class="sec-t">Без срока (${noDue.length}) — перетащите на день</div><div class="row">${noDue.map((t) => `<span class="cal-t" data-t="${t.id}" draggable="true">${esc(t.title)}</span>`).join("")}</div></div>` : ""}`;
  };

  const chip = (key, label, options) => `<select class="fchip${st[key] ? " on" : ""}" data-f="${key}" aria-label="${label}">${options.map(([v, l]) => `<option value="${v}"${st[key] === v ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  const draw = () => {
    const list = filtered();
    const projOpts = projects.filter((p) => (opts.scope === "dev" ? p.kind === "dev" : opts.scope === "client" ? p.kind === "client" : true));
    root.innerHTML = `<div class="tk-toolbar">
        <div class="dl-search"><input data-f="q" placeholder="Поиск по задачам" value="${esc(st.q)}"></div>
        ${chip("assignee", "Исполнитель", [["", "Все исполнители"], ["me", "Мои задачи"], ...S.people.map((p) => [p.id, p.name])])}
        ${chip("due", "Срок", [["", "Любой срок"], ["overdue", "Просроченные"], ["today", "На сегодня"], ["week", "На 7 дней"], ["none", "Без срока"]])}
        ${chip("prio", "Приоритет", [["", "Любой приоритет"], ["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]])}
        ${!opts.projectId && !opts.dealId && !["deals", "general"].includes(opts.scope) ? chip("project", "Проект", [["", opts.scope === "dev" ? "Все направления" : "Все проекты"], ...projOpts.map((p) => [p.id, p.name])]) : ""}
        <label class="fchk"><input type="checkbox" data-done-toggle${st.status !== "open" ? " checked" : ""}> выполненные</label>
        <span class="small muted">${list.length} из ${tasks.length}</span>
        <span class="grow"></span>
        <div class="seg">${VIEWS.map(([k, l]) => `<button data-view="${k}" aria-pressed="${st.view === k}">${l}</button>`).join("")}</div>
        <button class="btn primary" data-new>+ Задача</button></div>
      <div data-body>${st.view === "kanban" ? viewKanban(list) : st.view === "matrix" ? viewMatrix(list) : st.view === "calendar" ? viewCalendar(list) : viewList(list)}</div>`;
    bind();
  };

  const save = async (id, patch) => {
    const t = tasks.find((x) => x.id === id);
    if (patch.status === "done") patch.done_at = new Date().toISOString();
    else if (patch.status) patch.done_at = null;
    Object.assign(t, patch);
    const { error } = await sb.from("tasks").update(patch).eq("id", id);
    if (error) toast(error.message, true);
  };

  const bind = () => {
    $$("[data-view]", root).forEach((b) => (b.onclick = () => { st.view = b.dataset.view; pref("view", st.view); draw(); }));
    $$("[data-f]", root).forEach((el) => (el[el.tagName === "INPUT" ? "oninput" : "onchange"] = () => { st[el.dataset.f] = el.value; const pos = el.selectionStart; draw(); if (el.tagName === "INPUT") { const n = $(`[data-f="${el.dataset.f}"]`, root); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }));
    $("[data-done-toggle]", root).onchange = (e) => { st.status = e.target.checked ? "all" : "open"; draw(); };
    const reload = async () => { await load(); draw(); };
    $("[data-new]", root).onclick = () => taskForm({ project_id: opts.projectId || null, deal_id: opts.dealId || null, assignee: S.profile.person_id }, reload, projects);
    const qa = $("[data-quick]", root); if (qa) qa.onclick = () => taskForm({ project_id: opts.projectId || null, deal_id: opts.dealId || null, assignee: S.profile.person_id }, reload, projects);
    $$("[data-t]", root).forEach((el) => (el.onclick = (e) => { if (e.target.closest("input,label,.tk-del")) return; taskCanvas(tasks.find((x) => x.id === el.dataset.t), reload, projects, deals); }));
    $$("[data-tdel]", root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = tasks.find((x) => x.id === b.dataset.tdel); delRec({ table: "tasks", id: t.id, what: `задачу «${t.title}»`, done: reload }); }));
    $$("[data-done]", root).forEach((cb) => (cb.onchange = async () => { await save(cb.dataset.done, { status: cb.checked ? "done" : "todo" }); if (cb.checked) toast("Задача выполнена"); draw(); }));
    $$("[data-mon]", root).forEach((b) => (b.onclick = () => { const v = Number(b.dataset.mon); if (!v) st.month = today().slice(0, 7); else { const [y, m] = st.month.split("-").map(Number); st.month = iso(new Date(y, m - 1 + v, 1)).slice(0, 7); } draw(); }));
    $$("[draggable=true]", root).forEach((el) => { el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", el.dataset.t); el.classList.add("drag"); }; el.ondragend = () => el.classList.remove("drag"); });
    const drop = (sel, fn) => $$(sel, root).forEach((z) => { z.ondragover = (e) => { e.preventDefault(); z.classList.add("over"); }; z.ondragleave = (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove("over"); }; z.ondrop = async (e) => { e.preventDefault(); z.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) { await fn(id, z); draw(); } }; });
    drop("[data-drop]", (id, z) => save(id, { status: z.dataset.drop }));
    drop("[data-q]", (id, z) => { const q = z.dataset.q; return save(id, { important: q === "q1" || q === "q2", urgent: q === "q1" || q === "q3", priority: q === "q1" || q === "q2" ? "high" : "medium" }); });
    drop("[data-day]", (id, z) => { const t = tasks.find((x) => x.id === id); const tm = dueTime(t) || "18:00"; return save(id, { due_at: new Date(`${z.dataset.day}T${tm}:00`).toISOString() }); });
    // колёсико мыши листает квадраты Эйзенхауэра вправо
    $$(".eis-body", root).forEach((b) => (b.onwheel = (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && b.scrollWidth > b.clientWidth) { b.scrollLeft += e.deltaY; e.preventDefault(); } }));
  };

  await load();
  draw();
  return { reload: async () => { await load(); draw(); } };
}

/** Новая задача — короткая форма; существующая — полноэкранная карточка. */
export function taskForm(t, done, projects = []) {
  if (t.id) return taskCanvas(t, done, projects);
  modal({
    title: "Новая задача",
    body: `${field("Задача", "title", "", { req: true })}${field("Описание", "description", "", { rows: 3 })}
      <div class="grid4">${field("Срок", "due", addDays(today(), 1), { type: "date" })}${field("Время", "time", "12:00", { type: "time" })}${field("Исполнитель", "assignee", t.assignee || "", { options: [["", "—"], ...S.people.map((p) => [p.id, p.name])] })}${field("Приоритет", "priority", "medium", { options: Object.entries(PR).map(([k, [l]]) => [k, l]) })}</div>
      ${!t.deal_id ? field("Проект / развитие", "project_id", t.project_id || "", { options: [["", "—"], ...projects.map((p) => [p.id, (p.kind === "dev" ? "Развитие: " : "") + p.name])] }) : ""}
      <div class="row"><label class="chk"><input type="checkbox" name="important"> Важно</label><label class="chk"><input type="checkbox" name="urgent"> Срочно</label></div>`,
    footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Создать</button>`,
    onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async () => {
      const v = formData(el); if (!v.title) return toast("Введите название задачи", true);
      const row = { title: v.title, description: v.description, assignee: v.assignee || null, priority: v.priority, important: v.important, urgent: v.urgent, project_id: v.project_id || t.project_id || null, deal_id: t.deal_id || null, due_at: v.due ? new Date(`${v.due}T${v.time || "00:00"}:00`).toISOString() : null };
      const r = await sb.from("tasks").insert(row); if (r.error) return toast(r.error.message, true);
      close(); done && done();
    }),
  });
}

/** Карточка задачи (полноэкранная, как во «Включи систему»): слева параметры, справа комментарии. */
export async function taskCanvas(t, done, projects, deals) {
  if (!projects || !projects.length) projects = check(await sb.from("projects").select("id,name,kind"));
  if (!deals) deals = check(await sb.from("deals").select("id,title"));
  const root = document.getElementById("modalRoot");
  const wrap = document.createElement("div"); wrap.className = "dcv-scrim"; root.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); done && done(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  let notes = [];
  const loadNotes = async () => { const r = await sb.from("task_notes").select("*").eq("task_id", t.id).order("created_at"); notes = r.error ? [] : r.data; };
  await loadNotes();
  const save = async (patch) => { const r = await sb.from("tasks").update(patch).eq("id", t.id); if (r.error) return toast(r.error.message, true); Object.assign(t, patch); };
  const row = (key, label, display) => `<div class="dcv-f" data-fk="${key}"><div class="dcv-fl">${label}</div><div class="dcv-fv${display ? "" : " is-empty"}">${display || "—"}</div></div>`;
  const render = () => {
    const proj = projects.find((p) => p.id === t.project_id), deal = deals.find((x) => x.id === t.deal_id), dl = dueLabel(t);
    const comments = Array.isArray(t.comments) ? t.comments : [];
    wrap.innerHTML = `<div class="dcv" role="dialog" aria-label="Задача">
      <aside class="dcv-left" style="flex-basis:46%">
        <div class="tc-grad"></div>
        <header class="dcv-head light"><div class="grow" style="min-width:0"><div class="dcv-title"><span data-title class="dcv-title-t" title="Нажмите, чтобы изменить">${t.header && HEADERS[t.header] ? HEADERS[t.header] + ": " : ""}${esc(t.title)}</span>${t.status === "done" ? `<span class="st good">выполнена</span>` : ""}</div>
          <div class="dcv-sub">${proj ? `<a href="#/${proj.kind === "dev" ? "dev" : "projects"}/${proj.id}" data-nav>${esc(proj.name)}</a>` : deal ? `Сделка: ${esc(deal.title || "")}` : "Без привязки"} · создана ${d(iso(new Date(t.created_at)))}${t.auto ? " · автозадача" : ""}</div></div>
          ${can("tasks", "delete") ? `<button class="dcv-hbtn danger" data-del title="Удалить">🗑</button>` : ""}<button class="dcv-hbtn" data-close title="Закрыть (Esc)">✕</button></header>
        <div class="tc-status">${Object.entries(ST).map(([k, l]) => `<button data-st="${k}" class="${t.status === k ? "on" : ""}" style="--c:${ST_COLOR[k]}">${l}</button>`).join("")}</div>
        <div class="dcv-fields">
          ${row("assignee", "Исполнитель", t.assignee ? esc(personName(t.assignee)) : "")}
          ${row("due", "Срок", t.due_at ? `<span class="tk-due ${dl.cls}">${esc(new Date(t.due_at).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }))}</span>` : "")}
          ${row("priority", "Приоритет", `<span class="tk-pr pr-${t.priority}">${PR[t.priority][2]}</span> ${PR[t.priority][0]}`)}
          ${row("flags", "Матрица Эйзенхауэра", [t.important ? "важно" : "", t.urgent ? "срочно" : ""].filter(Boolean).join(", ") || "")}
          ${t.deal_id ? "" : row("project", "Проект / развитие", proj ? esc(proj.name) : "")}
          ${t.stage_name ? `<div class="dcv-f"><div class="dcv-fl">Этап шаблона</div><div class="dcv-fv">${esc(t.stage_name)}${t.step ? ` · шаг ${t.step}` : ""}</div></div>` : ""}
          ${Array.isArray(t.checklist) && t.checklist.length ? `<div class="tc-desc"><div class="dcv-fl" style="margin-bottom:4px">Чек-лист · ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</div><div class="tk-cl">${t.checklist.map((c, i) => `<label class="${c.done ? "done" : ""}"><input type="checkbox" data-cl="${i}"${c.done ? " checked" : ""}><span>${esc(c.t)}</span></label>`).join("")}</div></div>` : ""}
          <div class="tc-desc"><div class="dcv-fl" style="margin-bottom:6px">Описание</div><textarea id="tdesc" rows="6" placeholder="Подробности, ссылки, чек-лист…">${esc(t.description)}</textarea></div>
        </div>
        <div class="dcv-contact"><label class="chk" style="font-weight:600"><input type="checkbox" data-complete${t.status === "done" ? " checked" : ""}> ${t.status === "done" ? "Выполнена " + (t.done_at ? d(iso(new Date(t.done_at))) : "") : "Отметить выполненной"}</label></div>
      </aside><div class="dcv-split"></div>
      <section class="dcv-right"><div class="dcv-feed" id="tfeed">
          <div class="dcv-day"><span>Комментарии, отчёты и файлы · ${comments.length + notes.length}</span></div>
          ${[...comments.map((c) => ({ at: c.at, who: c.user, text: c.text })), ...notes.map((n) => ({ at: n.created_at, who: personName(n.person_id), text: n.text, n }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((c) => `<div class="dcv-note${c.n && c.n.via === "telegram" ? " tg" : ""}"><div class="dcv-note-h"><b>${esc(c.who)}</b>${c.n && c.n.via === "telegram" ? `<span class="tg-b">Telegram</span>` : ""}<span class="muted">${new Date(c.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>${c.text ? `<div class="dcv-note-t">${esc(c.text)}</div>` : ""}${c.n && c.n.file_path ? `<button class="tn-file" data-nf="${c.n.id}">📎 ${esc(c.n.file_name || "файл")}${c.n.file_size ? ` <span class="muted">· ${Math.max(1, Math.round(c.n.file_size / 1024))} КБ</span>` : ""}</button>` : ""}</div>`).join("") || `<div class="muted small" style="text-align:center;padding:30px">Комментариев пока нет</div>`}</div>
        <div class="dcv-composer"><div class="dcv-pill"><button class="dcv-clip" id="cfile" title="Прикрепить файл">📎</button><textarea id="ctext" rows="1" placeholder="Напишите комментарий или отчёт"></textarea><button class="dcv-send" id="csend" title="Отправить (Ctrl+Enter)">➤</button></div></div></section></div>`;
    bind();
    const f = $("#tfeed", wrap); f.scrollTop = f.scrollHeight;
  };
  const edit = (rowEl) => {
    const key = rowEl.dataset.fk, box = rowEl.querySelector(".dcv-fv");
    let html;
    if (key === "assignee") html = `<select><option value="">—</option>${S.people.map((p) => `<option value="${p.id}"${p.id === t.assignee ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
    else if (key === "priority") html = `<select>${Object.entries(PR).map(([k, [l]]) => `<option value="${k}"${t.priority === k ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    else if (key === "project") html = `<select><option value="">—</option>${projects.map((p) => `<option value="${p.id}"${p.id === t.project_id ? " selected" : ""}>${esc((p.kind === "dev" ? "Развитие: " : "") + p.name)}</option>`).join("")}</select>`;
    else if (key === "due") html = `<div class="row" style="gap:6px;flex-wrap:nowrap"><input type="date" value="${t.due_at ? dueDate(t) : ""}"><input type="time" value="${dueTime(t)}"></div>`;
    else if (key === "flags") html = `<div class="row"><label class="chk"><input type="checkbox" data-fl="important"${t.important ? " checked" : ""}> важно</label><label class="chk"><input type="checkbox" data-fl="urgent"${t.urgent ? " checked" : ""}> срочно</label></div>`;
    box.classList.remove("is-empty"); box.innerHTML = html;
    if (key === "flags") { $$("[data-fl]", box).forEach((cb) => (cb.onchange = async () => { await save({ [cb.dataset.fl]: cb.checked }); })); box.onmouseleave = render; return; }
    if (key === "due") {
      const [di, ti] = box.querySelectorAll("input"); di.focus();
      const commit = async () => { setTimeout(async () => { if (box.contains(document.activeElement)) return; await save({ due_at: di.value ? new Date(`${di.value}T${ti.value || "00:00"}:00`).toISOString() : null }); render(); }, 0); };
      di.onblur = ti.onblur = commit; return;
    }
    const inp = box.firstElementChild; inp.focus();
    inp.onchange = async () => { const v = inp.value || null; await save(key === "assignee" ? { assignee: v } : key === "priority" ? { priority: v } : { project_id: v }); render(); };
    inp.onblur = () => setTimeout(render, 150);
  };
  const bind = () => {
    $$("[data-close]", wrap).forEach((b) => (b.onclick = close));
    $$("[data-nav]", wrap).forEach((a) => a.addEventListener("click", () => { wrap.remove(); document.removeEventListener("keydown", onKey); }));
    $$("[data-fk]", wrap).forEach((r) => (r.onclick = (e) => { if (e.target.closest("input,select")) return; edit(r); }));
    $$("[data-st]", wrap).forEach((b) => (b.onclick = async () => { const s = b.dataset.st; await save({ status: s, done_at: s === "done" ? new Date().toISOString() : null }); render(); }));
    $("[data-complete]", wrap).onchange = async (e) => { await save({ status: e.target.checked ? "done" : "todo", done_at: e.target.checked ? new Date().toISOString() : null }); render(); };
    $$("[data-cl]", wrap).forEach((cb) => (cb.onchange = async () => { const cl = t.checklist.map((c, i) => (i === +cb.dataset.cl ? { ...c, done: cb.checked } : c)); await save({ checklist: cl }); render(); }));
    $("#tdesc", wrap).onchange = async (e) => { await save({ description: e.target.value }); toast("Описание сохранено"); };
    $("[data-title]", wrap).onclick = (e) => {
      const sp = e.currentTarget, inp = document.createElement("input"); inp.className = "dcv-title-in light"; inp.value = t.title; sp.replaceWith(inp); inp.focus();
      inp.onkeydown = (ev) => { if (ev.key === "Enter") inp.blur(); if (ev.key === "Escape") { inp.onblur = null; render(); } };
      inp.onblur = async () => { const v = inp.value.trim(); if (v && v !== t.title) await save({ title: v }); render(); };
    };
    const tdl = $("[data-del]", wrap); if (tdl) tdl.onclick = () => delRec({ table: "tasks", id: t.id, what: `задачу «${t.title}»`, done: close });
    const ta = $("#ctext", wrap);
    const send = async () => { const text = ta.value.trim(); if (!text) return; const comments = [...(t.comments || []), { at: new Date().toISOString(), user: S.profile.name, text }]; await save({ comments }); render(); $("#ctext", wrap).focus(); };
    ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
    ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); };
    $("#csend", wrap).onclick = send;
    $$("[data-nf]", wrap).forEach((b) => (b.onclick = async () => { const n = notes.find((x) => x.id === b.dataset.nf); const { data } = await sb.storage.from("docs").createSignedUrl(n.file_path, 3600, { download: n.file_name || true }); if (data) window.open(data.signedUrl, "_blank"); }));
    $("#cfile", wrap).onclick = () => {
      const i = document.createElement("input"); i.type = "file"; i.multiple = true;
      i.onchange = async () => {
        for (const f of i.files) {
          const ext = (f.name.split(".").pop() || "bin").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "bin";
          const path = `tasks/${t.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
          try { await uploadFile(path, f, f.type || "application/octet-stream"); check(await sb.from("task_notes").insert({ task_id: t.id, person_id: S.profile.person_id, text: "", file_path: path, file_name: f.name, file_size: f.size, via: "app" })); } catch (e) { toast(e.message, true); }
        }
        await loadNotes(); render(); toast("Файл прикреплён");
      };
      i.click();
    };
  };
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  render();
}

/** Раздел «Задачи»: вкладки по видам. */
export async function tasksPage(main, scope = "all") {
  const TABS = [["all", "Все задачи"], ["client", "По проектам"], ["dev", "По развитию"], ["deals", "По сделкам"], ["general", "Без привязки"]];
  main.innerHTML = `<div class="dl-title" style="margin-bottom:10px"><h1>Задачи</h1></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/tasks/${k}" class="${scope === k ? "on" : ""}">${l}</a>`).join("")}</div><div id="tb"></div>`;
  await taskBoard($("#tb", main), { scope });
}
