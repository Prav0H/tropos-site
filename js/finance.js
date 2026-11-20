// Финансы компании — по образцу раздела «Финансы» во «Включи систему»:
// Деньги (счета и операции), Календарь (платёжный, с остатком на начало дня), Бюджет (план/факт по статьям),
// Движение средств (по месяцам), Зарплата (начисления и выплаты). Счета и статьи — в «Настройках».
import { sb, S, check, personName, accruals } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast, modal, confirmBox, field, formData } from "./ui.js?v=15";
import { today, iso, parse, addDays } from "./calendar.js?v=15";
import { can } from "./access.js?v=15";
import { payouts } from "./views.js?v=15";

const TYPE = { in: "Доход", out: "Расход", transfer: "Перевод" };
const KIND = { bank: "Банк", cash: "Наличные", card: "Карта" };
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const n = (v) => Number(v) || 0;
const sgn = (v) => (v < 0 ? "−" : "") + rub(Math.abs(v));
const cls = (v) => (v < 0 ? "neg" : v > 0 ? "pos" : "");
const mKey = (s) => String(s).slice(0, 7);
const mStart = (m) => m + "-01";
const mEnd = (m) => { const [y, mm] = m.split("-").map(Number); return iso(new Date(y, mm, 0)); };
const mShift = (m, k) => { const [y, mm] = m.split("-").map(Number); return iso(new Date(y, mm - 1 + k, 1)).slice(0, 7); };
const mTitle = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const clientLabel = (c) => (c ? (c.kind === "ИП" ? "ИП " : c.kind + " ") + c.name : "");

// фильтры и выбранные месяцы живут, пока открыта программа
const ST = { preset: "month", from: mStart(mKey(today())), to: mEnd(mKey(today())), type: "", acc: "", cat: "", plan: "", month: mKey(today()), bmonth: mKey(today()), year: today().slice(0, 4) };

export async function loadFinRefs() {
  const [acc, cat, cs, prj] = await Promise.all([sb.from("fin_accounts").select("*").order("sort"), sb.from("fin_categories").select("*").order("sort"), sb.from("contracts").select("id,number,client_id,participants,total"), sb.from("projects").select("id,name,kind")]).then((r) => r.map(check));
  return { acc, cat, cs, prj };
}
async function load() {
  const [refs, ops, inv, cl, pays, outs] = await Promise.all([loadFinRefs(),
    sb.from("fin_ops").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    sb.from("invoices").select("id,number,amount,due_date,status,contract_id").in("status", ["issued", "overdue"]),
    sb.from("clients").select("id,kind,name"), sb.from("payments").select("*"), sb.from("payouts").select("person_id,amount")]);
  return { ...refs, ops: check(ops), inv: check(inv), cl: check(cl), pays: check(pays), outs: check(outs) };
}

/* ====================== страница ====================== */
export async function financePage(main, tab) {
  const all = can("finance", "watchAll");
  const TABS = all ? [["money", "Деньги"], ["calendar", "Календарь"], ["budget", "Бюджет"], ["dds", "Движение средств"], ["salary", "Зарплата"]] : [["salary", "Моя зарплата"]];
  if (tab === "setup") return location.replace("#/settings/finance"); // счета и статьи переехали в настройки
  if (!TABS.some((t) => t[0] === tab)) tab = TABS[0][0];
  main.innerHTML = `<div class="page-head"><h1>Финансы</h1></div><div class="set-tabs">${TABS.map(([k, l]) => `<a href="#/finance/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</div><div class="hub-sub" id="fs"><div class="boot">Загрузка…</div></div>`;
  const sub = $("#fs", main);
  if (tab === "salary") return payouts(sub);
  const D = await load();
  const re = () => financePage(main, tab);
  ({ money: moneyTab, calendar: calendarTab, budget: budgetTab, dds: ddsTab })[tab](sub, D, re);
}
/** Счета и статьи — вкладка в «Настройках». */
export async function finSetup(root) { root.innerHTML = `<div class="boot">Загрузка…</div>`; const D = await load(); setupTab(root, D, () => finSetup(root)); }

const helpers = (D) => ({
  accName: (id) => (D.acc.find((a) => a.id === id) || {}).name || "—",
  catName: (id) => (D.cat.find((c) => c.id === id) || {}).name || "Без статьи",
  link: (o) => { const c = D.cs.find((x) => x.id === o.contract_id), p = D.prj.find((x) => x.id === o.project_id); return [c ? `<a href="#/contracts/${c.id}">дог. № ${esc(c.number)}</a>` : "", p ? `<a href="#/${p.kind === "dev" ? "dev" : "projects"}/${p.id}/money">${esc(p.name)}</a>` : "", o.person_id ? esc(personName(o.person_id)) : ""].filter(Boolean).join(" · "); },
});
/** Остаток счёта по проведённым операциям. */
function accBalance(D, a) {
  return n(a.opening) + D.ops.filter((o) => !o.planned).reduce((s, o) => s + (o.type === "in" && o.account_id === a.id ? n(o.amount) : o.type === "out" && o.account_id === a.id ? -n(o.amount) : o.type === "transfer" ? (o.to_account_id === a.id ? n(o.amount) : 0) - (o.account_id === a.id ? n(o.amount) : 0) : 0), 0);
}
const flow = (o) => (o.type === "in" ? n(o.amount) : o.type === "out" ? -n(o.amount) : 0);

/* ====================== деньги ====================== */
function moneyTab(root, D, re) {
  const edit = can("finance", "edit"), H = helpers(D), t = today(), m = mKey(t);
  const PRESETS = { month: ["Этот месяц", mStart(m), mEnd(m)], prev: ["Прошлый месяц", mStart(mShift(m, -1)), mEnd(mShift(m, -1))], q: ["3 месяца", mStart(mShift(m, -2)), mEnd(m)], year: ["Этот год", t.slice(0, 4) + "-01-01", t.slice(0, 4) + "-12-31"], all: ["Всё время", "2000-01-01", "2100-01-01"] };
  const owed = D.cs.flatMap((c) => accruals(c, D.pays)).filter((a) => a.person_id).reduce((s, a) => s + a.amount, 0) - D.outs.reduce((s, o) => s + n(o.amount), 0);
  const wait = D.inv.reduce((s, i) => s + n(i.amount), 0);
  const total = D.acc.filter((a) => a.active).reduce((s, a) => s + accBalance(D, a), 0);
  const draw = () => {
    const list = D.ops.filter((o) => o.date >= ST.from && o.date <= ST.to && (!ST.type || o.type === ST.type) && (!ST.acc || o.account_id === ST.acc || o.to_account_id === ST.acc) && (!ST.cat || o.category_id === ST.cat) && (!ST.plan || (ST.plan === "plan") === o.planned));
    const fact = list.filter((o) => !o.planned), inc = fact.filter((o) => o.type === "in").reduce((s, o) => s + n(o.amount), 0), out = fact.filter((o) => o.type === "out").reduce((s, o) => s + n(o.amount), 0);
    root.innerHTML = `<div class="fin-accs">${D.acc.filter((a) => a.active).map((a) => { const b = accBalance(D, a); return `<button class="fin-acc${ST.acc === a.id ? " on" : ""}" data-acc="${a.id}"><span>${esc(a.name)} · ${KIND[a.kind]}</span><b class="${b < 0 ? "neg" : ""}">${sgn(b)}</b></button>`; }).join("")}
        <div class="fin-acc tot"><span>Всего денег</span><b class="${total < 0 ? "neg" : ""}">${sgn(total)}</b></div></div>
      <div class="grid4" style="margin:14px 0">
        <div class="card kpi"><div class="small muted">Доходы за период</div><div class="v pos">${rub(inc)}</div></div>
        <div class="card kpi"><div class="small muted">Расходы за период</div><div class="v neg">${rub(out)}</div></div>
        <div class="card kpi"><div class="small muted">Результат за период</div><div class="v ${cls(inc - out)}">${inc - out > 0 ? "+" : ""}${sgn(inc - out)}</div></div>
        <div class="card kpi"><div class="small muted">Ждём от клиентов / должны команде</div><div class="v" style="font-size:18px">${rub(wait)} / ${rub(Math.max(0, owed))}</div><div class="s">счета к оплате и начисленная, но не выплаченная зарплата</div></div></div>
      <div class="row between" style="margin-bottom:10px"><div class="filters" style="margin:0">
          <select id="fp">${Object.entries(PRESETS).map(([k, [l]]) => `<option value="${k}"${ST.preset === k ? " selected" : ""}>${l}</option>`).join("")}<option value="custom"${ST.preset === "custom" ? " selected" : ""}>Свои даты</option></select>
          ${ST.preset === "custom" ? `<input type="date" id="ff" value="${ST.from}"><input type="date" id="ft" value="${ST.to}">` : ""}
          <select id="fty"><option value="">Все операции</option>${Object.entries(TYPE).map(([k, l]) => `<option value="${k}"${ST.type === k ? " selected" : ""}>${l}ы</option>`).join("")}</select>
          <select id="fc"><option value="">Все статьи</option>${D.cat.map((c) => `<option value="${c.id}"${ST.cat === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <select id="fpl"><option value="">Факт и план</option><option value="fact"${ST.plan === "fact" ? " selected" : ""}>Проведённые</option><option value="plan"${ST.plan === "plan" ? " selected" : ""}>Плановые</option></select></div>
        ${edit ? `<div class="row"><button class="btn primary" data-new="in">+ Доход</button><button class="btn" data-new="out">+ Расход</button><button class="btn" data-new="transfer">⇄ Перевод</button></div>` : ""}</div>
      <div class="card flush">${list.length ? `<div class="tw"><table class="t"><tr><th>Дата</th><th>Операция</th><th>Статья</th><th>Счёт</th><th>Комментарий</th><th class="n">Сумма</th></tr>
        ${list.map((o) => `<tr class="click" data-op="${o.id}"><td class="nowrap">${d(o.date)}</td><td>${TYPE[o.type]}${o.planned ? ` <span class="st warn">план</span>` : ""}</td><td>${o.type === "transfer" ? "—" : esc(H.catName(o.category_id))}</td><td>${esc(H.accName(o.account_id))}${o.type === "transfer" ? " → " + esc(H.accName(o.to_account_id)) : ""}</td><td class="small">${esc(o.comment)}${o.comment && H.link(o) ? " · " : ""}${H.link(o)}</td><td class="n nowrap ${o.type === "in" ? "pos" : o.type === "out" ? "neg" : ""}">${o.type === "in" ? "+" : o.type === "out" ? "−" : ""}${rub(o.amount)}</td></tr>`).join("")}
        <tr class="fin-foot"><td colspan="5">Проведено за период: доходы ${rub(inc)}, расходы ${rub(out)}</td><td class="n nowrap ${cls(inc - out)}">${sgn(inc - out)}</td></tr></table></div>` : `<div class="empty" style="border:0">Операций за период нет.${edit ? " Нажмите «+ Доход» или «+ Расход»." : ""}</div>`}</div>`;
    $("#fp", root).onchange = (e) => { ST.preset = e.target.value; if (PRESETS[ST.preset]) [, ST.from, ST.to] = PRESETS[ST.preset]; draw(); };
    const ff = $("#ff", root); if (ff) { ff.onchange = (e) => { ST.from = e.target.value || ST.from; draw(); }; $("#ft", root).onchange = (e) => { ST.to = e.target.value || ST.to; draw(); }; }
    $("#fty", root).onchange = (e) => { ST.type = e.target.value; draw(); };
    $("#fc", root).onchange = (e) => { ST.cat = e.target.value; draw(); };
    $("#fpl", root).onchange = (e) => { ST.plan = e.target.value; draw(); };
    $$("[data-acc]", root).forEach((b) => (b.onclick = () => { ST.acc = ST.acc === b.dataset.acc ? "" : b.dataset.acc; draw(); }));
    $$("[data-new]", root).forEach((b) => (b.onclick = () => opForm({ type: b.dataset.new, date: today(), account_id: ST.acc || undefined }, D, re)));
    $$("[data-op]", root).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest("a")) return; opForm(D.ops.find((o) => o.id === tr.dataset.op), D, re); }));
  };
  draw();
}

/* ====================== операция ====================== */
export function opForm(o, R, done) {
  const edit = can("finance", "edit"), synced = !!(o.payment_id || o.payout_id), lock = synced ? "disabled" : "";
  const acc = R.acc.filter((a) => a.active || a.id === o.account_id || a.id === o.to_account_id);
  const accOpts = [["", "—"], ...acc.map((a) => [a.id, a.name])];
  const catOpts = (type) => [["", "Без статьи"], ...R.cat.filter((c) => c.type === type && (c.active || c.id === o.category_id)).map((c) => [c.id, c.name])];
  modal({
    title: o.id ? `${TYPE[o.type]}${o.planned ? " (плановый)" : ""}` : `Новая операция`,
    body: `${synced ? `<div class="note info">Операция создана автоматически из ${o.payment_id ? "оплаты клиента по договору" : "выплаты сотруднику"}. Дата и сумма меняются там же, здесь — счёт, статья и комментарий.</div>` : ""}
      <div class="grid3">${field("Операция", "type", o.type || "out", { options: Object.entries(TYPE), attrs: lock })}${field("Дата", "date", o.date || today(), { type: "date", attrs: lock })}${field("Сумма, ₽", "amount", o.amount, { type: "number", attrs: `min="0" step="0.01" ${lock}` })}</div>
      <div class="grid3">${field("Счёт", "account_id", o.account_id || (acc[0] && acc[0].id) || "", { options: accOpts })}<div data-to>${field("На счёт", "to_account_id", o.to_account_id || "", { options: accOpts })}</div><div data-cat>${field("Статья", "category_id", o.category_id || "", { options: catOpts(o.type === "in" ? "in" : "out") })}</div></div>
      <div class="grid3">${field("Договор", "contract_id", o.contract_id || "", { options: [["", "—"], ...R.cs.map((c) => [c.id, "№ " + c.number])], attrs: lock })}${field("Проект", "project_id", o.project_id || "", { options: [["", "—"], ...R.prj.map((p) => [p.id, (p.kind === "dev" ? "Развитие: " : "") + p.name])] })}${field("Сотрудник", "person_id", o.person_id || "", { options: [["", "—"], ...S.people.map((p) => [p.id, p.name])], attrs: lock })}</div>
      ${field("Комментарий", "comment", o.comment)}
      ${synced ? "" : `<label class="chk"><input type="checkbox" name="planned"${o.planned ? " checked" : ""}> Плановая — ещё не прошла (попадёт в платёжный календарь)</label>`}`,
    footer: edit ? `${o.id && !synced && can("finance", "delete") ? `<button class="btn danger" data-del>Удалить</button>` : ""}${o.id && o.planned ? `<button class="btn" data-run>Провести сегодня</button>` : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>` : `<button class="btn" data-close>Закрыть</button>`,
    onMount: (el, close) => {
      const ty = el.querySelector("[name=type]"), catBox = el.querySelector("[data-cat]"), toBox = el.querySelector("[data-to]");
      const sync = (keep) => {
        const tr = ty.value === "transfer"; toBox.style.visibility = tr ? "" : "hidden"; catBox.style.visibility = tr ? "hidden" : "";
        if (!keep) catBox.innerHTML = field("Статья", "category_id", "", { options: catOpts(ty.value === "in" ? "in" : "out") });
      };
      ty.onchange = () => sync(false); sync(true);
      if (!edit) return;
      const collect = () => {
        const v = formData(el);
        if (synced) return { account_id: v.account_id || null, category_id: v.category_id || null, project_id: v.project_id || null, comment: v.comment };
        if (!(v.amount > 0)) { toast("Укажите сумму", true); return null; }
        if (!v.account_id) { toast("Выберите счёт", true); return null; }
        if (v.type === "transfer" && (!v.to_account_id || v.to_account_id === v.account_id)) { toast("Выберите другой счёт, на который переводите", true); return null; }
        return { type: v.type, date: v.date || today(), amount: v.amount, account_id: v.account_id, to_account_id: v.type === "transfer" ? v.to_account_id : null, category_id: v.type === "transfer" ? null : v.category_id || null, contract_id: v.contract_id || null, project_id: v.project_id || null, person_id: v.person_id || null, comment: v.comment, planned: !!v.planned };
      };
      const write = async (row) => { const r = o.id ? await sb.from("fin_ops").update(row).eq("id", o.id) : await sb.from("fin_ops").insert(row); if (r.error) return toast(r.error.message, true); close(); done && done(); };
      el.querySelector("[data-ok]").onclick = () => { const row = collect(); if (row) write(row); };
      const run = el.querySelector("[data-run]"); if (run) run.onclick = () => { const row = collect(); if (row) write({ ...row, planned: false, date: today() }); };
      const del = el.querySelector("[data-del]"); if (del) del.onclick = async () => { if (!(await confirmBox("Удалить операцию?", "Удалить"))) return; const r = await sb.from("fin_ops").delete().eq("id", o.id); if (r.error) return toast(r.error.message, true); close(); done && done(); };
    },
  });
}

/* ====================== платёжный календарь ====================== */
function calendarTab(root, D, re) {
  const edit = can("finance", "edit"), H = helpers(D), t = today();
  // события: проведённые — на своей дате; плановые и неоплаченные счета — на своей дате, просроченные переносятся на сегодня
  const ev = [];
  D.ops.forEach((o) => { if (o.type === "transfer") return; const late = o.planned && o.date < t; ev.push({ date: late ? t : o.date, amt: flow(o), plan: o.planned, late, label: (o.comment || H.catName(o.category_id)), op: o }); });
  D.inv.forEach((i) => { const c = D.cs.find((x) => x.id === i.contract_id), due = i.due_date || t, late = due < t; ev.push({ date: late ? t : due, amt: n(i.amount), plan: true, late, label: `Счёт № ${i.number}${c ? " · " + clientLabel(D.cl.find((x) => x.id === c.client_id)) : ""}`, inv: i }); });
  const opening = D.acc.filter((a) => a.active).reduce((s, a) => s + n(a.opening), 0);
  const startBal = (day) => opening + ev.reduce((s, e) => s + (e.date < day ? e.amt : 0), 0);
  const draw = () => {
    const m = ST.month, first = mStart(m), last = mEnd(m), wd0 = (parse(first).getDay() + 6) % 7, days = Number(last.slice(8));
    const cells = []; for (let i = 0; i < wd0; i++) cells.push(null); for (let i = 1; i <= days; i++) cells.push(`${m}-${String(i).padStart(2, "0")}`); while (cells.length % 7) cells.push(null);
    const inM = ev.filter((e) => e.date >= first && e.date <= last);
    const planIn = inM.filter((e) => e.plan && e.amt > 0).reduce((s, e) => s + e.amt, 0), planOut = inM.filter((e) => e.plan && e.amt < 0).reduce((s, e) => s - e.amt, 0);
    const b0 = startBal(first), b1 = startBal(addDays(last, 1));
    let gap = null; for (let i = 1; i <= days && !gap; i++) { const day = `${m}-${String(i).padStart(2, "0")}`; if (day >= t && startBal(addDays(day, 1)) < 0) gap = day; }
    root.innerHTML = `<div class="row between" style="margin-bottom:10px"><div class="row" style="gap:6px"><button class="btn sm" id="pm">‹</button><b style="min-width:150px;text-align:center;font:700 16px var(--display)">${mTitle(m)}</b><button class="btn sm" id="nm">›</button><button class="btn sm ghost" id="tm">Сегодня</button></div>
        ${edit ? `<div class="row"><button class="btn primary" data-new="in">+ Плановый доход</button><button class="btn" data-new="out">+ Плановый расход</button></div>` : ""}</div>
      <div class="grid4" style="margin-bottom:12px"><div class="card kpi"><div class="small muted">Денег на начало месяца</div><div class="v ${b0 < 0 ? "neg" : ""}">${sgn(b0)}</div></div>
        <div class="card kpi"><div class="small muted">Ожидаем поступлений</div><div class="v pos">${rub(planIn)}</div><div class="s">плановые доходы и счета к оплате</div></div>
        <div class="card kpi"><div class="small muted">Запланировано расходов</div><div class="v neg">${rub(planOut)}</div></div>
        <div class="card kpi"><div class="small muted">Прогноз на конец месяца</div><div class="v ${b1 < 0 ? "neg" : ""}">${sgn(b1)}</div></div></div>
      ${gap ? `<div class="note" style="margin-bottom:12px">Кассовый разрыв: ${d(gap)} денег по плану не хватает. Перенесите расход или ускорьте поступление.</div>` : ""}
      <div class="card flush"><div class="tw"><div class="fin-cal"><div class="fin-wd">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w) => `<div>${w}</div>`).join("")}</div>
        <div class="fin-grid">${cells.map((day) => { if (!day) return `<div class="fin-cell off"></div>`; const es = ev.filter((e) => e.date === day), sb0 = startBal(day);
          return `<div class="fin-cell${day === t ? " today" : ""}" data-day="${day}"><div class="fin-ch"><span class="fin-dn">${Number(day.slice(8))}</span><span class="fin-db ${sb0 < 0 ? "neg" : ""}" title="Денег на начало дня">${sgn(sb0)}</span></div>
            ${es.slice(0, 4).map((e) => `<div class="fin-ev${e.plan ? " plan" : ""}${e.late ? " late" : ""}" data-ev="${ev.indexOf(e)}" title="${esc(e.label)}${e.late ? " — просрочено" : ""}"><b class="${e.amt < 0 ? "neg" : "pos"}">${e.amt < 0 ? "−" : "+"}${rub(Math.abs(e.amt))}</b><span>${esc(e.label)}</span></div>`).join("")}${es.length > 4 ? `<div class="small muted">и ещё ${es.length - 4}</div>` : ""}</div>`; }).join("")}</div></div></div></div>
      <p class="small muted">В ячейке сверху — сколько денег на начало дня. Пунктир — плановая операция или счёт, который ещё не оплачен; красная рамка — просрочено, перенесено на сегодня. Нажмите на день, чтобы запланировать платёж.</p>`;
    $("#pm", root).onclick = () => { ST.month = mShift(m, -1); draw(); };
    $("#nm", root).onclick = () => { ST.month = mShift(m, 1); draw(); };
    $("#tm", root).onclick = () => { ST.month = mKey(t); draw(); };
    $$("[data-new]", root).forEach((b) => (b.onclick = () => opForm({ type: b.dataset.new, date: m === mKey(t) ? t : first, planned: true }, D, re)));
    $$("[data-day]", root).forEach((c) => (c.onclick = (e) => {
      const x = e.target.closest("[data-ev]");
      if (x) { const it = ev[+x.dataset.ev]; if (it.inv) return (location.hash = `#/contracts/${it.inv.contract_id}`); return opForm(it.op, D, re); }
      if (edit) opForm({ type: "out", date: c.dataset.day, planned: c.dataset.day > t }, D, re);
    }));
  };
  draw();
}

/* ====================== бюджет: план и факт по статьям ====================== */
async function budgetTab(root, D, re) {
  const edit = can("finance", "edit"), m = ST.bmonth, prev = mShift(m, -1);
  const rows = check(await sb.from("fin_budget").select("*").in("month", [m, prev]));
  const plan = (id) => n((rows.find((r) => r.month === m && r.category_id === id) || {}).amount);
  const ops = D.ops.filter((o) => mKey(o.date) === m && o.type !== "transfer");
  const sum = (id, type, planned) => ops.filter((o) => o.type === type && (o.category_id || "") === id && o.planned === planned).reduce((s, o) => s + n(o.amount), 0);
  const sec = (type) => {
    const cats = D.cat.filter((c) => c.type === type && (c.active || plan(c.id) || sum(c.id, type, false)));
    const list = [...cats.map((c) => ({ id: c.id, name: c.name })), ...(sum("", type, false) || sum("", type, true) ? [{ id: "", name: "Без статьи" }] : [])];
    let tp = 0, tf = 0, tq = 0;
    const body = list.map((c) => { const p = c.id ? plan(c.id) : 0, f = sum(c.id, type, false), q = sum(c.id, type, true), pct = p ? Math.min(100, (f / p) * 100) : 0, over = type === "out" && p && f > p; tp += p; tf += f; tq += q;
      return `<tr><td>${esc(c.name)}</td><td class="n" style="width:150px">${c.id && edit ? `<input type="number" min="0" step="100" data-b="${c.id}" value="${p || ""}" placeholder="0" style="width:130px;text-align:right">` : p ? rub(p) : "—"}</td><td class="n">${f ? rub(f) : "—"}</td><td class="n small muted">${q ? rub(q) : "—"}</td><td class="n ${type === "out" ? (p - f < 0 ? "neg" : "") : f - p < 0 ? "neg" : "pos"}">${p || f ? sgn(type === "out" ? p - f : f - p) : "—"}</td><td style="width:140px"><div class="bar"><i style="width:${pct}%${over ? ";background:var(--bad)" : ""}"></i></div></td></tr>`; }).join("");
    return { html: `<tr class="fin-sec"><td>${type === "in" ? "Доходы" : "Расходы"}</td><td class="n">${rub(tp)}</td><td class="n">${rub(tf)}</td><td class="n small">${tq ? rub(tq) : "—"}</td><td class="n">${sgn(type === "out" ? tp - tf : tf - tp)}</td><td></td></tr>${body}`, tp, tf };
  };
  const I = sec("in"), O = sec("out");
  root.innerHTML = `<div class="row between" style="margin-bottom:10px"><div class="row" style="gap:6px"><button class="btn sm" id="pm">‹</button><b style="min-width:150px;text-align:center;font:700 16px var(--display)">${mTitle(m)}</b><button class="btn sm" id="nm">›</button></div>
      ${edit ? `<button class="btn" id="cp">Скопировать план прошлого месяца</button>` : ""}</div>
    <div class="grid3" style="margin-bottom:12px"><div class="card kpi"><div class="small muted">Доходы: план / факт</div><div class="v" style="font-size:19px">${rub(I.tp)} / <span class="pos">${rub(I.tf)}</span></div></div>
      <div class="card kpi"><div class="small muted">Расходы: план / факт</div><div class="v" style="font-size:19px">${rub(O.tp)} / <span class="neg">${rub(O.tf)}</span></div></div>
      <div class="card kpi"><div class="small muted">Результат: план / факт</div><div class="v" style="font-size:19px"><span class="${cls(I.tp - O.tp)}">${sgn(I.tp - O.tp)}</span> / <span class="${cls(I.tf - O.tf)}">${sgn(I.tf - O.tf)}</span></div></div></div>
    <div class="card flush"><div class="tw"><table class="t"><tr><th>Статья</th><th class="n">План на месяц</th><th class="n">Факт</th><th class="n">Ещё в календаре</th><th class="n">Отклонение</th><th>Выполнение</th></tr>${I.html}${O.html}</table></div></div>
    <p class="small muted">План вводится прямо в таблице и сохраняется сразу. «Отклонение»: по расходам — сколько ещё можно потратить (минус — перерасход), по доходам — насколько факт выше плана. Статьи настраиваются в «Настройки → Счета и статьи».</p>`;
  $("#pm", root).onclick = () => { ST.bmonth = prev; budgetTab(root, D, re); };
  $("#nm", root).onclick = () => { ST.bmonth = mShift(m, 1); budgetTab(root, D, re); };
  $$("[data-b]", root).forEach((inp) => (inp.onchange = async () => { const r = await sb.from("fin_budget").upsert({ month: m, category_id: inp.dataset.b, amount: Math.max(0, n(inp.value)) }); if (r.error) return toast(r.error.message, true); budgetTab(root, D, re); }));
  const cp = $("#cp", root); if (cp) cp.onclick = async () => {
    const src = rows.filter((r) => r.month === prev && n(r.amount)); if (!src.length) return toast(`В плане на ${mTitle(prev).toLowerCase()} пусто`, true);
    if (rows.some((r) => r.month === m && n(r.amount)) && !(await confirmBox("План на этот месяц уже заполнен. Заменить его планом прошлого месяца?", "Заменить"))) return;
    const r = await sb.from("fin_budget").upsert(src.map((x) => ({ month: m, category_id: x.category_id, amount: x.amount }))); if (r.error) return toast(r.error.message, true); toast("План скопирован"); budgetTab(root, D, re);
  };
}

/* ====================== движение средств по месяцам ====================== */
function ddsTab(root, D) {
  const draw = () => {
    const y = ST.year, ms = MONTHS.map((_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
    const fact = D.ops.filter((o) => !o.planned && o.type !== "transfer");
    const opening = D.acc.filter((a) => a.active).reduce((s, a) => s + n(a.opening), 0);
    const cell = (v, c = "") => `<td class="n nowrap ${c}">${v ? rub(Math.abs(v)) : "—"}</td>`;
    const line = (name, f, c = "", strong = false) => { const vals = ms.map(f), tot = vals.reduce((a, b) => a + b, 0); return `<tr class="${strong ? "fin-sec" : ""}"><td class="fin-stick">${esc(name)}</td>${vals.map((v) => cell(v, c)).join("")}${cell(tot, c)}</tr>`; };
    const by = (type, id) => (m) => fact.filter((o) => o.type === type && mKey(o.date) === m && (id === undefined || (o.category_id || "") === id)).reduce((s, o) => s + n(o.amount), 0);
    const cats = (type) => [...D.cat.filter((c) => c.type === type && ms.some((m) => by(type, c.id)(m))).map((c) => [c.name, c.id]), ...(ms.some((m) => by(type, "")(m)) ? [["Без статьи", ""]] : [])];
    const bal = (m) => opening + fact.filter((o) => mKey(o.date) < m).reduce((s, o) => s + flow(o), 0);
    const balRow = (name, f) => `<tr class="fin-sec"><td class="fin-stick">${name}</td>${ms.map((m) => { const v = f(m); return `<td class="n nowrap ${v < 0 ? "neg" : ""}">${sgn(v)}</td>`; }).join("")}<td></td></tr>`;
    const net = (m) => by("in")(m) - by("out")(m), netVals = ms.map(net), netTot = netVals.reduce((a, b) => a + b, 0);
    root.innerHTML = `<div class="row" style="gap:6px;margin-bottom:10px"><button class="btn sm" id="py">‹</button><b style="min-width:70px;text-align:center;font:700 16px var(--display)">${y}</b><button class="btn sm" id="ny">›</button><span class="small muted">Только проведённые операции, переводы между своими счетами не считаются.</span></div>
      <div class="card flush"><div class="tw"><table class="t fin-dds"><tr><th class="fin-stick">Статья</th>${MONTHS.map((x) => `<th class="n">${x.slice(0, 3)}</th>`).join("")}<th class="n">Итого</th></tr>
        ${balRow("Денег на начало месяца", bal)}
        ${line("Поступления", by("in"), "pos", true)}${cats("in").map(([nm, id]) => line("· " + nm, by("in", id))).join("")}
        ${line("Выплаты", by("out"), "neg", true)}${cats("out").map(([nm, id]) => line("· " + nm, by("out", id))).join("")}
        <tr class="fin-sec"><td class="fin-stick">Чистый поток</td>${netVals.map((v) => `<td class="n nowrap ${cls(v)}">${v ? sgn(v) : "—"}</td>`).join("")}<td class="n nowrap ${cls(netTot)}">${sgn(netTot)}</td></tr>
        ${balRow("Денег на конец месяца", (m) => bal(mShift(m, 1)))}</table></div></div>`;
    $("#py", root).onclick = () => { ST.year = String(+y - 1); draw(); };
    $("#ny", root).onclick = () => { ST.year = String(+y + 1); draw(); };
  };
  draw();
}

/* ====================== счета и статьи ====================== */
function setupTab(root, D, re) {
  const used = (k, id) => D.ops.filter((o) => o[k] === id || (k === "account_id" && o.to_account_id === id)).length;
  root.innerHTML = `<div class="cols"><div class="card flush"><div class="row between" style="padding:14px 16px 8px"><div class="sec-t" style="margin:0">Счета и кассы</div><button class="btn sm" id="na">+ Счёт</button></div>
      <div class="tw"><table class="t"><tr><th>Счёт</th><th>Вид</th><th class="n">Начальный остаток</th><th class="n">Сейчас</th></tr>${D.acc.map((a) => `<tr class="click" data-a="${a.id}" style="${a.active ? "" : "opacity:.5"}"><td>${esc(a.name)}${a.active ? "" : " · архив"}</td><td>${KIND[a.kind]}</td><td class="n">${rub(a.opening)}</td><td class="n">${sgn(accBalance(D, a))}</td></tr>`).join("")}</table></div></div>
    <div class="card flush"><div class="row between" style="padding:14px 16px 8px"><div class="sec-t" style="margin:0">Статьи доходов и расходов</div><button class="btn sm" id="nc">+ Статья</button></div>
      <div class="tw"><table class="t"><tr><th>Статья</th><th>Тип</th><th class="n">Операций</th></tr>${D.cat.map((c) => `<tr class="click" data-c="${c.id}" style="${c.active ? "" : "opacity:.5"}"><td>${esc(c.name)}${c.active ? "" : " · архив"}${c.code ? ` <span class="small muted">· системная</span>` : ""}</td><td>${c.type === "in" ? "доход" : "расход"}</td><td class="n">${used("category_id", c.id)}</td></tr>`).join("")}</table></div></div></div>
    <p class="small muted">«Начальный остаток» — сколько денег было на счёте до того, как вы начали вести учёт здесь. Системные статьи заполняются сами: оплаты клиентов по договорам и выплаты команде. Первый по списку счёт получает их по умолчанию — счёт можно поменять в самой операции.</p>`;
  const form = (table, x, body, extra = (v) => v) => modal({
    title: x.id ? x.name : table === "fin_accounts" ? "Новый счёт" : "Новая статья", body,
    footer: `${x.id && !x.code && can("finance", "delete") ? `<button class="btn danger" data-del>Удалить</button>` : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      el.querySelector("[data-ok]").onclick = async () => { const v = extra(formData(el)); if (!v.name) return toast("Укажите название", true); const r = x.id ? await sb.from(table).update(v).eq("id", x.id) : await sb.from(table).insert(v); if (r.error) return toast(r.error.message, true); close(); re(); };
      const del = el.querySelector("[data-del]"); if (del) del.onclick = async () => {
        const k = table === "fin_accounts" ? "account_id" : "category_id", cnt = used(k, x.id);
        if (cnt && table === "fin_accounts") return toast(`По счёту ${cnt} операций — удалить нельзя, снимите галочку «Действует»`, true);
        if (!(await confirmBox(cnt ? `По статье ${cnt} операций — они останутся «Без статьи». Удалить?` : "Удалить?", "Удалить"))) return;
        const r = await sb.from(table).delete().eq("id", x.id); if (r.error) return toast(r.error.message, true); close(); re();
      };
    },
  });
  const accForm = (a) => form("fin_accounts", a, `${field("Название", "name", a.name, { req: true })}<div class="grid2">${field("Вид", "kind", a.kind || "bank", { options: Object.entries(KIND) })}${field("Начальный остаток, ₽", "opening", a.opening || 0, { type: "number", attrs: 'step="0.01"' })}</div><label class="chk"><input type="checkbox" name="active"${a.active !== false ? " checked" : ""}> Действует</label>`, (v) => ({ ...v, opening: v.opening || 0, ...(a.id ? {} : { sort: D.acc.length + 1 }) }));
  const catForm = (c) => form("fin_categories", c, `${field("Название", "name", c.name, { req: true })}${field("Тип", "type", c.type || "out", { options: [["in", "доход"], ["out", "расход"]], attrs: c.code ? "disabled" : "" })}<label class="chk"><input type="checkbox" name="active"${c.active !== false ? " checked" : ""}> Действует</label>`, (v) => ({ ...v, ...(c.code ? { type: c.type } : {}), ...(c.id ? {} : { sort: D.cat.length + 1 }) }));
  $("#na", root).onclick = () => accForm({}); $("#nc", root).onclick = () => catForm({});
  $$("[data-a]", root).forEach((tr) => (tr.onclick = () => accForm(D.acc.find((a) => a.id === tr.dataset.a))));
  $$("[data-c]", root).forEach((tr) => (tr.onclick = () => catForm(D.cat.find((c) => c.id === tr.dataset.c))));
}
