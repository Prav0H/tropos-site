// Воронки продаж, сделки, автозадачи, настройки воронок, аналитика.
import { delRec } from "./del.js?v=15";
import { sb, S, check, isOwner, personName } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast, modal, confirmBox, field, formData, busy } from "./ui.js?v=15";
import { today, addWorkdays, iso, addDays } from "./calendar.js?v=15";
import { taskForm } from "./tasks.js?v=15";
import { clientForm } from "./views.js?v=15";
import { onlyOwn, can } from "./access.js?v=15";

let P = [], ST = [], TK = [], FL = [];
async function loadCfg() {
  const [p, s, t, f] = await Promise.all([sb.from("pipelines").select("*").order("sort"), sb.from("stages").select("*").order("sort"), sb.from("stage_tasks").select("*").order("sort"), sb.from("deal_fields").select("*").order("sort")]);
  P = check(p); ST = check(s); TK = check(t); FL = check(f);
}
const stageOf = (id) => ST.find((s) => s.id === id) || {};
const pipeOf = (id) => P.find((p) => p.id === id) || {};
const stagesOf = (pid) => ST.filter((s) => s.pipeline_id === pid).sort((a, b) => a.sort - b.sort);
const dealName = (dl) => dl.title || dl.fields.company || dl.fields.contactName || "Без названия";

async function dealEvent(id, text) { await sb.from("deal_events").insert({ deal_id: id, text, user_name: (S.profile && S.profile.name) || "" }); }

/** Срок автозадачи от текущего момента. */
function autoDue(t) {
  const now = new Date();
  if (t.due_minutes < 1440 || !t.workdays) return new Date(now.getTime() + t.due_minutes * 60000).toISOString();
  const day = addWorkdays(iso(now), Math.max(1, Math.round(t.due_minutes / 1440)));
  return new Date(`${day}T18:00:00`).toISOString();
}
async function createAutoTasks(deal, stageId) {
  const list = TK.filter((t) => t.stage_id === stageId);
  if (!list.length) return 0;
  const rows = list.map((t) => ({ title: t.title, deal_id: deal.id, assignee: deal.responsible || S.profile.person_id, due_at: autoDue(t), auto: true, priority: t.due_minutes <= 1440 ? "high" : "medium" }));
  check(await sb.from("tasks").insert(rows));
  return rows.length;
}

/** Перевод сделки на этап: проверка обязательных полей, автозадачи, история. */
async function moveDeal(deal, stageId) {
  const stg = stageOf(stageId);
  const need = FL.filter((f) => f.active && (f.required_stages || []).includes(stageId) && !String(deal.fields[f.key] ?? "").trim());
  if (need.length) {
    const ok = await new Promise((res) => modal({
      title: `Этап «${stg.name}»: заполните поля`, body: `<div class="note info">Для этого этапа обязательны поля ниже.</div>${need.map((f) => fieldInput(f, deal.fields[f.key])).join("")}`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Перевести</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-ok]").onclick = () => { const v = formData(el); for (const f of need) { if (!String(v["f_" + f.key] ?? "").trim()) return toast(`Заполните «${f.label}»`, true); deal.fields[f.key] = v["f_" + f.key]; } close(); res(true); };
        el.closest(".scrim").addEventListener("click", (e) => { if (e.target.classList.contains("scrim") || e.target.closest("[data-close]")) res(false); });
      },
    }));
    if (!ok) return false;
  }
  const from = stageOf(deal.stage_id);
  const patch = { stage_id: stageId, pipeline_id: stg.pipeline_id, fields: deal.fields, stage_at: new Date().toISOString(), closed_at: stg.kind === "open" ? null : new Date().toISOString() };
  check(await sb.from("deals").update(patch).eq("id", deal.id));
  Object.assign(deal, patch);
  const n = await createAutoTasks(deal, stageId);
  await dealEvent(deal.id, `Этап: ${from.name || "—"} → ${pipeOf(stg.pipeline_id).name}: ${stg.name}${n ? ` (автозадач: ${n})` : ""}`);
  toast(`Сделка на этапе «${stg.name}»${n ? `, поставлено задач: ${n}` : ""}`);
  return true;
}

function fieldInput(f, v) {
  const name = "f_" + f.key;
  if (f.type === "select") return field(f.label, name, v || "", { options: [["", "—"], ...(f.options || []).map((o) => [o, o])] });
  if (f.type === "textarea") return field(f.label, name, v, { rows: 2 });
  if (f.type === "person") return field(f.label, name, v || "", { options: [["", "—"], ...S.people.map((p) => [p.id, p.name])] });
  return field(f.label, name, v, { type: { date: "date", number: "number", email: "email", phone: "tel" }[f.type] || "text" });
}

/* ====================== ДОСКА СДЕЛОК (как во «Включи систему») ====================== */
const PRESETS = [["open", "Открытые"], ["my", "Мои"], ["all", "Все"], ["closed", "Закрытые"]];
const HEADERS = [["", "Без заголовка", "•"], ["contact", "Связаться", "📞"], ["meeting", "Встреча", "👥"], ["video", "Видеосвязь", "🎥"]];
const dd = (s) => { const x = new Date(s); return `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}`; };
const plural3 = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
function taskState(tk) {
  const open = tk.filter((t) => t.status !== "done");
  if (!open.length) return { level: "idle" };
  const now = new Date(), late = open.filter((t) => t.due_at && new Date(t.due_at) < now);
  if (late.length) { const days = Math.max(1, Math.floor((now - Math.min(...late.map((t) => new Date(t.due_at)))) / 864e5)); return { level: "overdue", days }; }
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  return open.some((t) => t.due_at && new Date(t.due_at) <= todayEnd) ? { level: "today" } : { level: "planned" };
}
const initialsOf = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

export async function dealsPage(main, pipeId) {
  await loadCfg();
  const pid = pipeId || (P.find((p) => p.active) || P[0]).id;
  let preset = (() => { try { return localStorage.getItem("tr_dpreset") || "open"; } catch (e) { return "open"; } })();
  let q = "", resp = "", src = "";
  let deals = [], tasks = [];
  const load = async () => {
    deals = check(await sb.from("deals").select("*").eq("pipeline_id", pid).order("stage_at", { ascending: false }));
    if (onlyOwn("deals")) deals = deals.filter((x) => x.responsible === S.profile.person_id);
    tasks = deals.length ? check(await sb.from("tasks").select("deal_id,due_at,status").in("deal_id", deals.map((x) => x.id))) : [];
  };
  await load();
  const pipe = pipeOf(pid);
  main.innerHTML = `<div class="dl-top">
      <div class="dl-title"><h1>Продажи</h1>
        <div class="dl-pipe"><select id="pp" aria-label="Воронка">${P.filter((p) => p.active).map((p) => `<option value="${p.id}"${p.id === pid ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div>
      <div class="dl-tools">
        <div class="dl-search"><input id="q" placeholder="Поиск по сделкам"></div>
        <div class="seg" id="pr">${PRESETS.map(([k, l]) => `<button data-pr="${k}" aria-pressed="${preset === k}">${l}</button>`).join("")}</div>
        <select id="fr" style="width:auto"><option value="">Все ответственные</option>${S.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
        <select id="fs" style="width:auto"><option value="">Все источники</option>${((FL.find((f) => f.key === "source") || {}).options || []).map((o) => `<option>${esc(o)}</option>`).join("")}</select>
        ${isOwner() ? `<a class="btn ghost" href="#/pipelines" title="Настроить воронки">⚙</a>` : ""}
        <button class="btn primary" id="nd">+ Сделка</button></div></div>
    <div id="board" class="dk"></div>`;
  const finalOnly = () => !stagesOf(pid).some((s) => s.kind === "open"); // воронка из одних итоговых этапов, как «Отказ»
  const filtered = () => deals.filter((x) => {
    const kind = stageOf(x.stage_id).kind;
    if (preset === "open" && kind !== "open" && !finalOnly()) return false;
    if (preset === "closed" && kind === "open") return false;
    if (preset === "my" && x.responsible !== S.profile.person_id) return false;
    if (resp && x.responsible !== resp) return false;
    if (src && x.fields.source !== src) return false;
    if (q && !JSON.stringify([x.title, x.fields]).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const cardHtml = (x) => {
    const st = taskState(tasks.filter((t) => t.deal_id === x.id)), kind = stageOf(x.stage_id).kind;
    const partner = x.fields.company && x.fields.company !== x.title ? x.fields.company : x.fields.contactName;
    return `<div class="dc status--${kind}" data-deal="${x.id}" draggable="true"><div class="dc-l">
        <div class="dc-title">${esc(dealName(x))}</div>${partner ? `<div class="dc-partner">${esc(partner)}</div>` : ""}
        ${Number(x.amount) ? `<div class="dc-budget">${rub(x.amount)}</div>` : ""}<div class="dc-resp">${esc(personName(x.responsible))}</div></div>
      <div class="dc-r"><div class="dc-date">${dd(x.created_at)}</div><div class="dc-st">${st.level === "overdue" ? `<span class="dc-od">${st.days} дн.</span>` : st.level === "idle" ? `<span class="dc-idle">нет задач</span>` : ""}<span class="dc-dot is-${st.level}" title="${{ overdue: "Есть просроченные задачи", today: "Задача на сегодня", planned: "Задачи запланированы", idle: "Нет открытых задач" }[st.level]}"></span></div></div></div>`;
  };
  const draw = () => {
    const list = filtered();
    const stages = finalOnly() ? stagesOf(pid) : stagesOf(pid).filter((s) => (preset === "closed" ? s.kind !== "open" : preset === "all" ? true : s.kind !== "lost" || list.some((x) => x.stage_id === s.id)));
    $("#board", main).innerHTML = stages.map((s, i) => {
      const col = list.filter((x) => x.stage_id === s.id), sum = col.reduce((a, x) => a + Number(x.amount || 0), 0);
      return `<div class="dk-col" data-drop="${s.id}"><div class="dk-h"><div class="dk-ht">${esc(s.name)}</div><div class="dk-sub">${col.length} ${plural3(col.length, "сделка", "сделки", "сделок")}${sum ? " · " + rub(sum) : ""}</div><div class="dk-line" style="background:${esc(s.color)}"></div>
        ${s.hint ? `<div class="dk-hint" title="${esc(s.hint)}">${esc(s.hint)}</div>` : ""}</div>
        ${i === 0 && preset !== "closed" ? `<div class="dk-quick" id="qa"><button class="btn sm ghost w100" data-qopen>+ Быстрое добавление</button></div>` : ""}
        <div class="dk-list">${col.map(cardHtml).join("") || `<div class="dk-empty">Перетащите сделку сюда</div>`}</div></div>`;
    }).join("");
    bindBoard();
  };
  const bindBoard = () => {
    $$("[data-deal]", main).forEach((el) => { el.onclick = () => dealCard(deals.find((x) => x.id === el.dataset.deal), async () => { await load(); draw(); }); el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", el.dataset.deal); el.classList.add("drag"); }; el.ondragend = () => el.classList.remove("drag"); });
    $$("[data-drop]", main).forEach((z) => { z.ondragover = (e) => { e.preventDefault(); z.classList.add("over"); }; z.ondragleave = (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove("over"); };
      z.ondrop = async (e) => { e.preventDefault(); z.classList.remove("over"); const dl = deals.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (dl && dl.stage_id !== z.dataset.drop) { if (await moveDeal(dl, z.dataset.drop)) { await load(); draw(); } } }; });
    const qo = $("[data-qopen]", main);
    if (qo) qo.onclick = () => {
      const box = $("#qa", main);
      box.innerHTML = `<div class="dk-qf"><input data-q="title" placeholder="Название сделки"><input data-q="name" placeholder="Контакт"><input data-q="phone" placeholder="Телефон" type="tel"><div class="row"><button class="btn sm primary" data-qadd>Добавить</button><button class="btn sm ghost" data-qx>Отмена</button></div></div>`;
      const t = $("[data-q=title]", box); t.focus();
      const add = async () => {
        const title = t.value.trim(); if (!title) return t.focus();
        const first = stagesOf(pid)[0];
        const dl = check(await sb.from("deals").insert({ title, pipeline_id: pid, stage_id: first.id, responsible: S.profile.person_id, fields: { company: title, contactName: $("[data-q=name]", box).value.trim(), contactPhone: $("[data-q=phone]", box).value.trim() } }).select().single());
        await createAutoTasks(dl, first.id); await dealEvent(dl.id, `Сделка создана на этапе «${first.name}»`);
        await load(); draw();
      };
      $("[data-qadd]", box).onclick = add;
      box.querySelectorAll("input").forEach((i) => (i.onkeydown = (e) => { if (e.key === "Enter") add(); if (e.key === "Escape") draw(); }));
      $("[data-qx]", box).onclick = draw;
    };
  };
  $("#pp", main).onchange = (e) => (location.hash = `#/deals/${e.target.value}`);
  $("#q", main).oninput = (e) => { q = e.target.value; draw(); };
  $("#fr", main).onchange = (e) => { resp = e.target.value; draw(); };
  $("#fs", main).onchange = (e) => { src = e.target.value; draw(); };
  $$("[data-pr]", main).forEach((b) => (b.onclick = () => { preset = b.dataset.pr; try { localStorage.setItem("tr_dpreset", preset); } catch (e) {} $$("[data-pr]", main).forEach((x) => x.setAttribute("aria-pressed", x.dataset.pr === preset)); draw(); }));
  $("#nd", main).onclick = async () => {
    const first = stagesOf(pid)[0];
    const dl = check(await sb.from("deals").insert({ title: "Новая сделка", pipeline_id: pid, stage_id: first.id, responsible: S.profile.person_id, fields: {} }).select().single());
    await createAutoTasks(dl, first.id); await dealEvent(dl.id, `Сделка создана на этапе «${first.name}»`);
    dealCard(dl, async () => { await load(); draw(); }, { editTitle: true });
  };
  draw();
}

/* ====================== КАРТОЧКА СДЕЛКИ (полноэкранная, две колонки) ====================== */
export async function dealCard(deal, done, opts = {}) {
  if (!P.length) await loadCfg();
  const root = document.getElementById("modalRoot");
  const wrap = document.createElement("div");
  wrap.className = "dcv-scrim";
  root.appendChild(wrap);
  let tab = "main", composerTab = "note", header = "", leftPct = 42;
  try { leftPct = Number(localStorage.getItem("tr_dcvw")) || 42; } catch (e) {}
  let tasks = [], evs = [], cls = [], offers = [], contracts = [];
  const load = async () => {
    [tasks, evs, cls, offers, contracts] = await Promise.all([
      sb.from("tasks").select("*").eq("deal_id", deal.id).order("due_at"),
      sb.from("deal_events").select("*").eq("deal_id", deal.id).order("at"),
      sb.from("clients").select("id,kind,name").order("name"),
      sb.from("offers").select("id,number,price,date,files").eq("deal_id", deal.id),
      deal.client_id ? sb.from("contracts").select("id,number,total,status,date").eq("client_id", deal.client_id) : Promise.resolve({ data: [] }),
    ]).then((r) => r.map(check));
  };
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); done && done(); };
  const onKey = (e) => { if (e.key === "Escape" && !wrap.querySelector(".dcv-menu, .dcv-stage-menu")) close(); };
  document.addEventListener("keydown", onKey);
  const save = async (patch) => { const r = await sb.from("deals").update(patch).eq("id", deal.id); if (r.error) return toast(r.error.message, true); Object.assign(deal, patch); };

  const fieldRow = (key, label, value, display, req) => `<div class="dcv-f${req ? " req" : ""}" data-fk="${key}"><div class="dcv-fl">${esc(label)}${req ? " *" : ""}</div><div class="dcv-fv${display ? "" : " is-empty"}">${display ? esc(display) : "—"}</div></div>`;
  const fieldDisplay = (f, v) => { if (v == null || v === "") return ""; if (f.type === "person") return personName(v); if (f.type === "date") return d(v); if (f.type === "number") return Number(v).toLocaleString("ru-RU"); return String(v); };

  const render = () => {
    const stg = stageOf(deal.stage_id), pipe = pipeOf(deal.pipeline_id);
    const days = Math.floor((Date.now() - new Date(deal.stage_at)) / 864e5);
    const f = deal.fields || {};
    const phone = String(f.contactPhone || "").replace(/[^\d+]/g, "");
    const open = tasks.filter((t) => t.status !== "done");
    const pinned = evs.filter((e) => e.pinned);
    // лента: события + выполненные задачи, по дням
    const items = [...evs.filter((e) => !e.pinned).map((e) => ({ at: e.at, ev: e })), ...tasks.filter((t) => t.status === "done").map((t) => ({ at: t.done_at || t.created_at, task: t }))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    let lastDay = "";
    const feed = items.map((it) => {
      const day = new Date(it.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
      const head = day !== lastDay ? `<div class="dcv-day"><span>${day}</span></div>` : ""; lastDay = day;
      const tm = new Date(it.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      if (it.task) return head + `<div class="dcv-ev sys"><span class="dcv-ev-ic">✓</span><div><b>Задача выполнена:</b> ${esc(it.task.title)} <span class="muted">· ${esc(personName(it.task.assignee))} · ${tm}</span></div></div>`;
      const e = it.ev;
      if (e.kind === "note") return head + `<div class="dcv-note"><div class="dcv-note-h"><b>${esc(e.user_name || "—")}</b><span class="muted">${tm}</span><button class="dcv-pin" data-pin="${e.id}" title="Закрепить">📌</button></div><div class="dcv-note-t">${esc(e.text)}</div></div>`;
      return head + `<div class="dcv-ev sys"><span class="dcv-ev-ic">•</span><div>${esc(e.text)} <span class="muted">· ${esc(e.user_name || "")} ${tm}</span></div></div>`;
    }).join("");
    const taskCard = (t) => { const late = t.due_at && new Date(t.due_at) < new Date(); const h = HEADERS.find((x) => x[0] === t.header); return `<div class="dcv-task${late ? " late" : ""}"><input type="checkbox" data-tdone="${t.id}" aria-label="Выполнить"><div class="grow"><div class="dcv-task-meta">${t.due_at ? new Date(t.due_at).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "без срока"} · ${esc(personName(t.assignee))}${t.auto ? " · авто" : ""}</div><div>${h && h[0] ? `<b>${h[2]} ${h[1]}:</b> ` : ""}${esc(t.title)}</div></div><button class="btn sm ghost" data-tedit="${t.id}" title="Изменить">✎</button></div>`; };
    const due0 = (() => { const x = new Date(); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10); })();
    wrap.innerHTML = `<div class="dcv" role="dialog" aria-label="Сделка">
      <aside class="dcv-left" style="flex-basis:${leftPct}%">
        <header class="dcv-head"><div class="grow" style="min-width:0">
            <div class="dcv-title"><span data-title class="dcv-title-t" title="Нажмите, чтобы изменить">${esc(dealName(deal))}</span><span class="dcv-id">#${deal.id.slice(0, 6)}</span></div>
            <div class="dcv-sub">${esc(pipe.name)} · создана ${d(iso(new Date(deal.created_at)))}</div></div>
          ${can("deals", "delete") ? `<button class="dcv-hbtn danger" data-dealdel title="Удалить сделку">🗑</button>` : ""}<button class="dcv-hbtn" data-menu title="Действия">⋯</button><button class="dcv-hbtn" data-close title="Закрыть (Esc)">✕</button></header>
        <div class="dcv-stage${stg.kind !== "open" ? " is-" + stg.kind : ""}" style="--sc:${esc(stg.color)}">
          <button class="dcv-stage-btn" data-stage><span class="dcv-stage-n">${esc(stg.name)}</span><span class="dcv-stage-t">${days ? `на этапе ${days} ${plural3(days, "день", "дня", "дней")}` : "на этапе с сегодня"}</span><span class="dcv-chev">▾</span></button>
          ${stg.kind !== "open" ? `<button class="dcv-reopen" data-reopen>↻ Возобновить</button>` : ""}</div>
        ${stg.hint ? `<div class="dcv-hint">${esc(stg.hint)}</div>` : ""}
        <div class="dcv-tabs">${[["main", "Основное"], ["docs", `Документы${offers.length + contracts.length ? " · " + (offers.length + contracts.length) : ""}`]].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="dcv-fields">${tab === "main" ? `
          ${fieldRow("_amount", "Бюджет", deal.amount, Number(deal.amount) ? rub(deal.amount) : "")}
          ${fieldRow("_responsible", "Ответственный", deal.responsible, personName(deal.responsible) === "—" ? "" : personName(deal.responsible))}
          ${fieldRow("_client", "Клиент для договора", deal.client_id, (cls.find((c) => c.id === deal.client_id) || {}).name ? ((x) => (x.kind === "ИП" ? "ИП " : x.kind + " ") + x.name)(cls.find((c) => c.id === deal.client_id)) : "")}
          ${FL.filter((x) => x.active).map((x) => fieldRow(x.key, x.label, f[x.key], fieldDisplay(x, f[x.key]), (x.required_stages || []).includes(deal.stage_id))).join("")}` : `
          <div class="dcv-docs"><div class="sec-t">КП</div>${offers.map((o) => `<div class="row between"><span>КП № ${o.number} от ${d(o.date)} · ${rub(o.price)}</span>${o.files && o.files.pdf ? `<button class="btn sm" data-kpdf="${esc(o.files.pdf)}">PDF</button>` : ""}</div>`).join("") || `<div class="muted small">Нет</div>`}
            <div class="sec-t" style="margin-top:14px">Договоры клиента</div>${contracts.map((c) => `<div class="row between"><a href="#/contracts/${c.id}" data-close-nav>№ ${esc(c.number)} от ${d(c.date)}</a><span>${rub(c.total)}</span></div>`).join("") || `<div class="muted small">${deal.client_id ? "Нет" : "Сначала выберите клиента для договора"}</div>`}
            <div class="row" style="margin-top:14px"><button class="btn sm" data-mkkp>+ КП</button><button class="btn sm" data-mkct>+ Договор</button></div></div>`}</div>
        <div class="dcv-contact">${f.contactName || phone ? `<div class="dcv-ava">${esc(initialsOf(f.contactName || f.company))}</div><div class="grow" style="min-width:0"><div class="dcv-cn">${esc(f.contactName || "Контакт")}</div><div class="dcv-cs">${esc([f.contactPosition, f.contactPhone].filter(Boolean).join(" · ") || "телефон не указан")}</div></div>
          ${phone ? `<a class="dcv-cbtn" href="tel:${esc(phone)}" title="Позвонить">📞</a><a class="dcv-cbtn" href="https://wa.me/${esc(phone.replace(/^\+/, "").replace(/^8/, "7"))}" target="_blank" rel="noopener" title="Написать в WhatsApp">WA</a><a class="dcv-cbtn" href="https://t.me/+${esc(phone.replace(/^\+/, "").replace(/^8/, "7"))}" target="_blank" rel="noopener" title="Написать в Telegram">TG</a>` : ""}`
          : `<button class="dcv-attach" data-fk="contactName">+ Прикрепить контакт</button>`}</div>
      </aside>
      <div class="dcv-split" data-split title="Потяните, чтобы изменить ширину"></div>
      <section class="dcv-right">
        ${pinned.length ? `<div class="dcv-pinned">${pinned.map((e) => `<div class="dcv-note pinned"><div class="dcv-note-h"><b>📌 ${esc(e.user_name || "")}</b><span class="muted">${new Date(e.at).toLocaleDateString("ru-RU")}</span><button class="dcv-pin" data-pin="${e.id}" title="Открепить">✕</button></div><div class="dcv-note-t">${esc(e.text)}</div></div>`).join("")}</div>` : ""}
        <div class="dcv-feed" id="dcvfeed">${feed || `<div class="muted small" style="text-align:center;padding:30px">Здесь будут примечания, история и выполненные задачи</div>`}
          ${open.length ? `<div class="dcv-day"><span>Открытые задачи · ${open.length}</span></div>${open.map(taskCard).join("")}` : `<div class="dcv-notask">У сделки нет открытой задачи — поставьте следующий шаг ниже</div>`}</div>
        <div class="dcv-composer">
          <div class="dcv-ctabs">${[["note", "Примечание"], ["task", "Задача"]].map(([k, l]) => `<button data-ct="${k}" class="${composerTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
          ${composerTab === "task" ? `<div class="dcv-chips"><span>Задача на</span><input type="date" id="tdue" value="${due0}"><input type="time" id="ttime" value="12:00"><span>для</span><select id="tass">${S.people.map((p) => `<option value="${p.id}"${p.id === (deal.responsible || S.profile.person_id) ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
            <select id="thead">${HEADERS.map(([k, l, i]) => `<option value="${k}"${header === k ? " selected" : ""}>${i} ${l}</option>`).join("")}</select></div>` : ""}
          <div class="dcv-pill"><textarea id="ctext" rows="1" placeholder="${composerTab === "task" ? "Что нужно сделать" : "Напишите примечание"}"></textarea><button class="dcv-send" id="csend" title="Отправить (Ctrl+Enter)">➤</button></div></div>
      </section></div>`;
    bind();
    const fd = $("#dcvfeed", wrap); if (fd) fd.scrollTop = fd.scrollHeight;
    if (opts.editTitle) { opts.editTitle = false; editTitle(); }
  };

  const editTitle = () => {
    const sp = $("[data-title]", wrap); const inp = document.createElement("input"); inp.className = "dcv-title-in"; inp.value = deal.title === "Новая сделка" ? "" : deal.title; inp.placeholder = "Название сделки";
    sp.replaceWith(inp); inp.focus();
    const commit = async () => { const v = inp.value.trim(); if (v && v !== deal.title) { await save({ title: v, fields: { ...deal.fields, company: deal.fields.company || v } }); } render(); };
    inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.onblur = null; render(); } };
    inp.onblur = commit;
  };

  const editField = (row) => {
    const key = row.dataset.fk, vbox = row.querySelector(".dcv-fv") || row;
    let html;
    if (key === "_amount") html = `<input type="number" value="${esc(deal.amount || "")}">`;
    else if (key === "_responsible") html = `<select><option value="">—</option>${S.people.map((p) => `<option value="${p.id}"${p.id === deal.responsible ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
    else if (key === "_client") html = `<select><option value="">— не выбран —</option>${cls.map((c) => `<option value="${c.id}"${c.id === deal.client_id ? " selected" : ""}>${esc((c.kind === "ИП" ? "ИП " : c.kind + " ") + c.name)}</option>`).join("")}<option value="__new">+ Создать клиента из сделки…</option></select>`;
    else {
      const fdef = FL.find((x) => x.key === key); const v = deal.fields[key] ?? "";
      if (!fdef) return;
      if (fdef.type === "select") html = `<select><option value="">—</option>${fdef.options.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      else if (fdef.type === "person") html = `<select><option value="">—</option>${S.people.map((p) => `<option value="${p.id}"${p.id === v ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
      else if (fdef.type === "textarea") html = `<textarea rows="3">${esc(v)}</textarea>`;
      else html = `<input type="${{ date: "date", number: "number", email: "email", phone: "tel" }[fdef.type] || "text"}" value="${esc(v)}">`;
    }
    if (row.classList.contains("dcv-attach")) { tab = "main"; render(); const r = $(`.dcv-f[data-fk="contactName"]`, wrap); if (r) editField(r); return; }
    vbox.classList.remove("is-empty"); vbox.innerHTML = html;
    const inp = vbox.firstElementChild; inp.focus();
    let doneEdit = false;
    const commit = async () => {
      if (doneEdit) return; doneEdit = true;
      const v = inp.value;
      if (key === "_amount") await save({ amount: Number(v) || 0 });
      else if (key === "_responsible") await save({ responsible: v || null });
      else if (key === "_client") {
        if (v === "__new") { const ff = deal.fields; return clientForm({ kind: "ООО", name: ff.company || deal.title, inn: ff.inn || "", contact_name: ff.contactName || "", contact_phone: ff.contactPhone || "", phone: ff.contactPhone || "", email: ff.contactEmail || "" }, async (c) => { await save({ client_id: c.id }); await load(); render(); }); }
        await save({ client_id: v || null }); await load();
      } else { const fields = { ...deal.fields, [key]: v }; await save({ fields }); }
      render();
    };
    inp.onblur = commit;
    if (inp.tagName === "SELECT") inp.onchange = () => inp.blur();
    inp.onkeydown = (e) => { if (e.key === "Enter" && inp.tagName !== "TEXTAREA") inp.blur(); if (e.key === "Escape") { doneEdit = true; render(); } };
  };

  const stageMenu = (btn) => {
    const r = btn.getBoundingClientRect();
    const m = document.createElement("div"); m.className = "dcv-stage-menu";
    m.style.left = r.left + "px"; m.style.top = r.bottom + 4 + "px"; m.style.width = Math.max(r.width, 300) + "px";
    m.innerHTML = P.filter((p) => p.active).map((p) => `<div class="dcv-sm-h">${esc(p.name)}</div>${stagesOf(p.id).map((s) => `<button data-to="${s.id}" class="${s.id === deal.stage_id ? "cur" : ""}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)}${s.kind === "won" ? " ✓" : ""}</button>`).join("")}`).join("");
    const back = document.createElement("div"); back.className = "dcv-backdrop"; back.onclick = () => { m.remove(); back.remove(); };
    wrap.appendChild(back); wrap.appendChild(m);
    $$("[data-to]", m).forEach((b) => (b.onclick = async () => { m.remove(); back.remove(); if (b.dataset.to !== deal.stage_id && (await moveDeal(deal, b.dataset.to))) { await load(); render(); } }));
  };

  const actionMenu = (btn) => {
    const r = btn.getBoundingClientRect();
    const m = document.createElement("div"); m.className = "dcv-menu"; m.style.top = r.bottom + 4 + "px"; m.style.left = Math.max(8, r.right - 220) + "px";
    m.innerHTML = `<button data-a="kp">Создать КП</button><button data-a="ct">Создать договор</button><button data-a="copy">Скопировать телефон</button>${can("deals", "delete") ? `<hr><button data-a="del" class="danger">Удалить сделку</button>` : ""}`;
    const back = document.createElement("div"); back.className = "dcv-backdrop"; back.onclick = () => { m.remove(); back.remove(); };
    wrap.appendChild(back); wrap.appendChild(m);
    $$("[data-a]", m).forEach((b) => (b.onclick = async () => {
      m.remove(); back.remove();
      const a = b.dataset.a;
      if (a === "kp") { close(); location.hash = `#/offers/new/${deal.id}`; }
      if (a === "ct") { if (!deal.client_id) { tab = "main"; render(); return toast("Выберите или создайте клиента в поле «Клиент для договора»", true); } close(); location.hash = `#/contracts/new/${deal.client_id}`; }
      if (a === "copy") { try { await navigator.clipboard.writeText(deal.fields.contactPhone || ""); toast("Телефон скопирован"); } catch (e) { toast("Не удалось скопировать", true); } }
      if (a === "del") delDeal();
    }));
  };

  const delDeal = () => delRec({ table: "deals", id: deal.id, what: `сделку «${dealName(deal)}»`, warn: "Вместе с ней удалятся её задачи и история.", done: () => close() });
  const send = async () => {
    const text = $("#ctext", wrap).value.trim(); if (!text) return $("#ctext", wrap).focus();
    if (composerTab === "note") { check(await sb.from("deal_events").insert({ deal_id: deal.id, kind: "note", text, user_name: S.profile.name })); }
    else {
      const due = $("#tdue", wrap).value, tm = $("#ttime", wrap).value || "12:00";
      header = $("#thead", wrap).value;
      check(await sb.from("tasks").insert({ deal_id: deal.id, title: text, header, assignee: $("#tass", wrap).value || null, due_at: due ? new Date(`${due}T${tm}:00`).toISOString() : null }));
      await dealEvent(deal.id, `Поставлена задача: ${text}`);
    }
    await load(); render();
  };

  const bind = () => {
    $$("[data-close]", wrap).forEach((b) => (b.onclick = close));
    $$("[data-close-nav]", wrap).forEach((a) => a.addEventListener("click", () => { wrap.remove(); document.removeEventListener("keydown", onKey); }));
    $("[data-title]", wrap).onclick = editTitle;
    $$("[data-fk]", wrap).forEach((row) => (row.onclick = (e) => { if (e.target.closest("input,select,textarea")) return; editField(row); }));
    $("[data-stage]", wrap).onclick = (e) => stageMenu(e.currentTarget);
    $("[data-menu]", wrap).onclick = (e) => actionMenu(e.currentTarget);
    const dd0 = $("[data-dealdel]", wrap); if (dd0) dd0.onclick = delDeal;
    const ro = $("[data-reopen]", wrap); if (ro) ro.onclick = async () => { if (await moveDeal(deal, stagesOf(P[0].id)[0].id)) { await load(); render(); } };
    $$("[data-tab]", wrap).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
    $$("[data-ct]", wrap).forEach((b) => (b.onclick = () => { composerTab = b.dataset.ct; render(); $("#ctext", wrap).focus(); }));
    $$("[data-tdone]", wrap).forEach((cb) => (cb.onchange = async () => { const t = tasks.find((x) => x.id === cb.dataset.tdone); await sb.from("tasks").update({ status: "done", done_at: new Date().toISOString() }).eq("id", t.id); await load(); render(); }));
    $$("[data-tedit]", wrap).forEach((b) => (b.onclick = () => taskForm(tasks.find((x) => x.id === b.dataset.tedit), async () => { await load(); render(); })));
    $$("[data-pin]", wrap).forEach((b) => (b.onclick = async () => { const e = evs.find((x) => x.id == b.dataset.pin); await sb.from("deal_events").update({ pinned: !e.pinned }).eq("id", e.id); await load(); render(); }));
    $$("[data-kpdf]", wrap).forEach((b) => (b.onclick = async () => { const { data } = await sb.storage.from("docs").createSignedUrl(b.dataset.kpdf, 3600); if (data) window.open(data.signedUrl, "_blank"); }));
    const mk = $("[data-mkkp]", wrap); if (mk) mk.onclick = () => { close(); location.hash = `#/offers/new/${deal.id}`; };
    const mc = $("[data-mkct]", wrap); if (mc) mc.onclick = () => { if (!deal.client_id) return toast("Сначала выберите клиента в поле «Клиент для договора»", true); close(); location.hash = `#/contracts/new/${deal.client_id}`; };
    const ta = $("#ctext", wrap);
    ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
    ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); };
    $("#csend", wrap).onclick = send;
    // ширина колонок
    const sp = $("[data-split]", wrap);
    sp.onmousedown = (e) => {
      e.preventDefault(); const box = $(".dcv", wrap).getBoundingClientRect();
      const mv = (ev) => { leftPct = Math.min(65, Math.max(28, ((ev.clientX - box.left) / box.width) * 100)); $(".dcv-left", wrap).style.flexBasis = leftPct + "%"; };
      const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); try { localStorage.setItem("tr_dcvw", Math.round(leftPct)); } catch (e) {} };
      document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    };
  };

  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  await load();
  render();
}

/* ====================== НАСТРОЙКА ВОРОНОК ====================== */
export async function pipelinesSettings(main) {
  await loadCfg();
  const unit = (m) => (m % 1440 === 0 ? [m / 1440, "d"] : [m / 60, "h"]);
  main.innerHTML = `<div class="page-head"><div><a href="#/deals" class="small">← Продажи</a><h1>Настройка воронок</h1></div><button class="btn" id="np">+ Воронка</button></div>
    ${P.map((p) => `<div class="card"><div class="row between"><input data-pn="${p.id}" value="${esc(p.name)}" style="max-width:320px;font-weight:600"><div class="row"><label class="chk"><input type="checkbox" data-pa="${p.id}"${p.active ? " checked" : ""}> показывать</label><button class="btn sm" data-ns="${p.id}">+ Этап</button><button class="btn sm ghost danger" data-pdel="${p.id}">Удалить воронку</button></div></div>
      <div class="stack" style="gap:10px;margin-top:12px">${stagesOf(p.id).map((s, i, arr) => `<div class="card" style="background:#fbfaf7;padding:12px">
        <div class="grid4" style="align-items:end"><label class="f">Этап<input data-s="${s.id}" data-k="name" value="${esc(s.name)}"></label>
          <label class="f">Тип<select data-s="${s.id}" data-k="kind">${[["open", "рабочий"], ["won", "успех"], ["lost", "отказ"]].map(([k, l]) => `<option value="${k}"${s.kind === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="f">Цвет<input type="color" data-s="${s.id}" data-k="color" value="${esc(/^#/.test(s.color) ? s.color : "#737373")}"></label>
          <div class="row"><button class="btn sm ghost" data-up="${s.id}"${i ? "" : " disabled"}>↑</button><button class="btn sm ghost" data-down="${s.id}"${i < arr.length - 1 ? "" : " disabled"}>↓</button><button class="btn sm ghost danger" data-sdel="${s.id}">Удалить</button></div></div>
        <label class="f" style="margin-top:8px">Описание этапа<input data-s="${s.id}" data-k="hint" value="${esc(s.hint)}"></label>
        <div class="small muted" style="margin:10px 0 4px">Автозадачи при попадании на этап (ставятся ответственному)</div>
        ${TK.filter((t) => t.stage_id === s.id).map((t) => { const [n, u] = unit(t.due_minutes); return `<div class="row" style="margin-bottom:6px"><input data-t="${t.id}" data-k="title" value="${esc(t.title)}" class="grow">
          <input type="number" min="0" data-t="${t.id}" data-k="n" value="${n}" style="width:80px"><select data-t="${t.id}" data-k="u" style="width:auto"><option value="h"${u === "h" ? " selected" : ""}>часов</option><option value="d"${u === "d" ? " selected" : ""}>дней</option></select>
          <label class="chk small"><input type="checkbox" data-t="${t.id}" data-k="workdays"${t.workdays ? " checked" : ""}> рабочих</label><button class="btn sm ghost danger" data-tdel="${t.id}">✕</button></div>`; }).join("")}
        <button class="btn sm" data-nt="${s.id}">+ Автозадача</button></div>`).join("")}</div></div>`).join("")}
    <div class="card"><div class="row between"><h2>Поля карточки сделки</h2><button class="btn sm" id="nf">+ Поле</button></div>
      <div class="tw" style="margin-top:10px"><table class="t"><tr><th>Название</th><th>Тип</th><th>Варианты (через ;)</th><th>Обязательно на этапах</th><th></th></tr>
      ${FL.map((f) => `<tr><td><input data-f="${f.id}" data-k="label" value="${esc(f.label)}"></td><td><select data-f="${f.id}" data-k="type">${["text", "textarea", "number", "select", "date", "phone", "email", "person"].map((t) => `<option${f.type === t ? " selected" : ""}>${t}</option>`).join("")}</select></td>
        <td><input data-f="${f.id}" data-k="options" value="${esc((f.options || []).join("; "))}"></td>
        <td><div class="chips">${ST.map((s) => `<button class="chip" style="font-size:11px;padding:3px 8px" data-fr="${f.id}" data-st="${s.id}" aria-pressed="${(f.required_stages || []).includes(s.id)}">${esc(s.name)}</button>`).join("")}</div></td>
        <td><label class="chk small"><input type="checkbox" data-f="${f.id}" data-k="active"${f.active ? " checked" : ""}> вкл.</label></td></tr>`).join("")}</table></div></div>`;
  const re = () => pipelinesSettings(main);
  const upd = async (table, id, patch) => { const r = await sb.from(table).update(patch).eq("id", id); if (r.error) toast(r.error.message, true); };
  $$("[data-pn]", main).forEach((i) => (i.onchange = () => upd("pipelines", i.dataset.pn, { name: i.value })));
  $$("[data-pa]", main).forEach((i) => (i.onchange = () => upd("pipelines", i.dataset.pa, { active: i.checked })));
  $$("[data-s]", main).forEach((i) => (i.onchange = () => upd("stages", i.dataset.s, { [i.dataset.k]: i.value })));
  $$("[data-t]", main).forEach((i) => (i.onchange = () => {
    const id = i.dataset.t, row = i.closest(".row");
    if (i.dataset.k === "title") return upd("stage_tasks", id, { title: i.value });
    if (i.dataset.k === "workdays") return upd("stage_tasks", id, { workdays: i.checked });
    const n = Number($(`[data-t="${id}"][data-k="n"]`, row).value) || 0, u = $(`[data-t="${id}"][data-k="u"]`, row).value;
    upd("stage_tasks", id, { due_minutes: Math.round(n * (u === "d" ? 1440 : 60)) });
  }));
  $$("[data-f]", main).forEach((i) => (i.onchange = () => { const k = i.dataset.k; const v = k === "active" ? i.checked : k === "options" ? i.value.split(";").map((x) => x.trim()).filter(Boolean) : i.value; upd("deal_fields", i.dataset.f, { [k]: v }); }));
  $$("[data-fr]", main).forEach((b) => (b.onclick = async () => { const f = FL.find((x) => x.id === b.dataset.fr); const set = new Set(f.required_stages || []); set.has(b.dataset.st) ? set.delete(b.dataset.st) : set.add(b.dataset.st); f.required_stages = [...set]; b.setAttribute("aria-pressed", set.has(b.dataset.st)); await upd("deal_fields", f.id, { required_stages: f.required_stages }); }));
  $$("[data-nt]", main).forEach((b) => (b.onclick = async () => { await sb.from("stage_tasks").insert({ stage_id: b.dataset.nt, title: "Новая задача", due_minutes: 1440, sort: 99 }); re(); }));
  $$("[data-tdel]", main).forEach((b) => (b.onclick = async () => { await sb.from("stage_tasks").delete().eq("id", b.dataset.tdel); re(); }));
  $$("[data-pdel]", main).forEach((b) => (b.onclick = async () => {
    const p = P.find((x) => x.id === b.dataset.pdel);
    const { count } = await sb.from("deals").select("id", { count: "exact", head: true }).eq("pipeline_id", p.id);
    if (count) return toast(`В воронке «${p.name}» ${count} сделок — сначала перенесите или удалите их.`, true);
    await delRec({ table: "pipelines", id: p.id, what: `воронку «${p.name}»`, warn: "Её этапы и автозадачи тоже удалятся.", before: async () => { const ids = stagesOf(p.id).map((s) => s.id); if (ids.length) { await sb.from("stage_tasks").delete().in("stage_id", ids); await sb.from("stages").delete().in("id", ids); } }, done: re });
  }));
  $$("[data-ns]", main).forEach((b) => (b.onclick = async () => { await sb.from("stages").insert({ pipeline_id: b.dataset.ns, name: "Новый этап", sort: stagesOf(b.dataset.ns).length + 1 }); re(); }));
  $$("[data-sdel]", main).forEach((b) => (b.onclick = async () => { const { count } = await sb.from("deals").select("id", { count: "exact", head: true }).eq("stage_id", b.dataset.sdel); if (count) return toast(`На этапе ${count} сделок — сначала переведите их`, true); if (await confirmBox("Удалить этап и его автозадачи?", "Удалить")) { await sb.from("stages").delete().eq("id", b.dataset.sdel); re(); } }));
  const swap = async (id, dir) => { const s = stageOf(id), arr = stagesOf(s.pipeline_id), i = arr.indexOf(s), o = arr[i + dir]; if (!o) return; await upd("stages", s.id, { sort: o.sort }); await upd("stages", o.id, { sort: s.sort === o.sort ? s.sort + dir : s.sort }); re(); };
  $$("[data-up]", main).forEach((b) => (b.onclick = () => swap(b.dataset.up, -1)));
  $$("[data-down]", main).forEach((b) => (b.onclick = () => swap(b.dataset.down, 1)));
  $("#np", main).onclick = async () => { const p = check(await sb.from("pipelines").insert({ name: "Новая воронка", sort: P.length + 1 }).select().single()); await sb.from("stages").insert([{ pipeline_id: p.id, name: "Новый", sort: 1 }, { pipeline_id: p.id, name: "Успех", kind: "won", color: "#1f8a5b", sort: 2 }]); re(); };
  $("#nf", main).onclick = async () => { await sb.from("deal_fields").insert({ key: "f" + Date.now().toString(36), label: "Новое поле", sort: FL.length + 1 }); re(); };
}

/* ====================== АНАЛИТИКА ПРОДАЖ ====================== */
export async function analytics(main) {
  await loadCfg();
  const [deals, cs, pays, cls] = await Promise.all([sb.from("deals").select("*"), sb.from("contracts").select("id,date,total,status,package_name,client_id,participants"), sb.from("payments").select("date,amount,contract_id"), sb.from("clients").select("id")]).then((r) => r.map(check));
  const o = S.settings.options || {};
  const planN = Number(o.plan_contracts) || 2, planSum = Number(o.plan_amount) || 100000;
  let month = today().slice(0, 7);
  const mk = (s) => String(s || "").slice(0, 7);
  const shift = (m, n) => { const [y, mm] = m.split("-").map(Number); return iso(new Date(y, mm - 1 + n, 1)).slice(0, 7); };
  const draw = () => {
    const okC = cs.filter((c) => !["draft", "terminated"].includes(c.status));
    const mc = okC.filter((c) => mk(c.date) === month), msum = mc.reduce((a, c) => a + Number(c.total), 0);
    const mpay = pays.filter((p) => mk(p.date) === month).reduce((a, p) => a + Number(p.amount), 0);
    const newD = deals.filter((x) => mk(x.created_at) === month);
    const won = deals.filter((x) => stageOf(x.stage_id).kind === "won" && mk(x.closed_at) === month);
    const lost = deals.filter((x) => stageOf(x.stage_id).kind === "lost" && mk(x.closed_at) === month);
    const conv = newD.length ? Math.round((won.length / newD.length) * 100) : 0;
    const pct = (a, b) => Math.min(100, Math.round((a / (b || 1)) * 100));
    const ms = []; for (let i = 5; i >= 0; i--) ms.push(shift(month, -i));
    const sums = ms.map((m) => okC.filter((c) => mk(c.date) === m).reduce((a, c) => a + Number(c.total), 0)), mx = Math.max(planSum, ...sums, 1);
    const sale = P[0], sStages = sale ? stagesOf(sale.id) : [];
    const reached = (s) => deals.filter((x) => { const xs = stageOf(x.stage_id); return xs.pipeline_id === sale.id ? xs.sort >= s.sort : false; }).length;
    const f0 = Math.max(1, deals.filter((x) => stageOf(x.stage_id).pipeline_id === sale.id).length);
    const lostAll = deals.filter((x) => stageOf(x.stage_id).kind === "lost"); const lostBy = {};
    lostAll.forEach((x) => { const n = stageOf(x.stage_id).name; lostBy[n] = (lostBy[n] || 0) + 1; });
    const srcBy = {}; deals.forEach((x) => { const s = x.fields.source || "не указан"; srcBy[s] = srcBy[s] || { n: 0, w: 0 }; srcBy[s].n++; if (stageOf(x.stage_id).kind === "won") srcBy[s].w++; });
    const pkgBy = {}; okC.forEach((c) => { const k = c.package_name || "индивидуальный"; pkgBy[k] = pkgBy[k] || { n: 0, s: 0 }; pkgBy[k].n++; pkgBy[k].s += Number(c.total); });
    const lmx = Math.max(1, ...Object.values(lostBy)), smx = Math.max(1, ...Object.values(srcBy).map((x) => x.n));
    const kpi = (l, v, s) => `<div class="card kpi"><div class="small muted">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    main.innerHTML = `<div class="page-head"><h1>Аналитика продаж</h1><div class="row"><button class="btn sm" data-m="-1">←</button><b style="min-width:140px;text-align:center">${new Date(month + "-01").toLocaleString("ru-RU", { month: "long", year: "numeric" })}</b><button class="btn sm" data-m="1">→</button></div></div>
      <div class="grid2">
        <div class="card"><div class="row between"><div class="sec-t" style="margin:0">План: договоры</div>${isOwner() ? `<button class="btn sm ghost" data-plan>Изменить план</button>` : ""}</div><div class="kpi"><div class="v">${mc.length} из ${planN}</div></div><div class="bar" style="margin:8px 0"><i style="width:${pct(mc.length, planN)}%"></i></div><div class="small muted">${pct(mc.length, planN)}% плана · договоры по дате, без черновиков и расторгнутых</div></div>
        <div class="card"><div class="sec-t">План: деньги</div><div class="kpi"><div class="v">${rub(msum)} из ${rub(planSum)}</div></div><div class="bar" style="margin:8px 0"><i style="width:${pct(msum, planSum)}%"></i></div><div class="small muted">${pct(msum, planSum)}% плана по сумме договоров · поступило денег ${rub(mpay)}</div></div>
      </div>
      <div class="grid4" style="margin-top:14px">${kpi("Новых сделок", newD.length, "заведено за месяц")}${kpi("Выиграно", won.length, `конверсия ${conv}%`)}${kpi("Отказов", lost.length, "переведено в «Отказ»")}${kpi("Средний чек", rub(mc.length ? msum / mc.length : 0), "по договорам месяца")}</div>
      <div class="cols" style="margin-top:14px"><div class="stack">
        <div class="card"><div class="sec-t">Сумма договоров по месяцам (линия — план ${rub(planSum)})</div><div class="vb" style="position:relative">${ms.map((m, i) => `<div><em>${sums[i] ? Math.round(sums[i] / 1000) + " т" : ""}</em><i style="height:${(sums[i] / mx) * 100}%;${m === month ? "background:var(--ink)" : ""}"></i><span>${new Date(m + "-01").toLocaleString("ru-RU", { month: "short" })}</span></div>`).join("")}<span style="position:absolute;left:0;right:0;bottom:${(planSum / mx) * 100 * 0.86 + 14}px;border-top:2px dashed #ff9a1f"></span></div></div>
        <div class="card"><div class="sec-t">Воронка «${esc(sale ? sale.name : "")}» за всё время — дошли до этапа</div><div class="stack" style="gap:6px">${sStages.map((s) => { const n = reached(s); return `<div class="hb"><span>${esc(s.name)}</span><div class="tr"><i style="width:${(n / f0) * 100}%;background:${esc(s.color)}"></i></div><b>${n} <span class="muted small">${Math.round((n / f0) * 100)}%</span></b></div>`; }).join("")}</div><div class="small muted" style="margin-top:6px">Считается по текущему этапу: сделка на этапе N прошла все предыдущие.</div></div>
      </div><div class="stack">
        <div class="card"><div class="sec-t">Источники: сделки и выигрыши</div><div class="stack" style="gap:6px">${Object.entries(srcBy).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<div class="hb"><span>${esc(k)}</span><div class="tr"><i style="width:${(v.n / smx) * 100}%"></i></div><b>${v.n} <span class="small muted">выигр. ${v.w}</span></b></div>`).join("") || `<span class="muted">Сделок пока нет</span>`}</div></div>
        <div class="card"><div class="sec-t">Причины отказов</div><div class="stack" style="gap:6px">${Object.entries(lostBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hb"><span>${esc(k)}</span><div class="tr"><i style="width:${(v / lmx) * 100}%;background:var(--bad)"></i></div><b>${v}</b></div>`).join("") || `<span class="muted">Отказов нет</span>`}</div></div>
        <div class="card"><div class="sec-t">По пакетам (все договоры)</div><table class="t"><tr><th>Пакет</th><th class="n">Шт.</th><th class="n">Сумма</th></tr>${Object.entries(pkgBy).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${rub(v.s)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Договоров нет</td></tr>`}</table></div>
      </div></div>`;
    $$("[data-m]", main).forEach((b) => (b.onclick = () => { month = shift(month, Number(b.dataset.m)); draw(); }));
    const pb = $("[data-plan]", main); if (pb) pb.onclick = () => modal({ title: "План продаж на месяц", body: `<div class="grid2">${field("Договоров в месяц", "n", planN, { type: "number" })}${field("Сумма в месяц, ₽", "s", planSum, { type: "number" })}</div>`, footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
      onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async () => { const v = formData(el); S.settings.options = { ...o, plan_contracts: v.n, plan_amount: v.s }; check(await sb.from("settings").update({ options: S.settings.options }).eq("id", 1)); close(); analytics(main); }) });
  };
  draw();
}
