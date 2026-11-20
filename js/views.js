// Экраны программы.
import { sb, S, isOwner, check, loadRefs, personName, recalc, createContract, updateContract, createInvoice, createAct, sendAct, autoAcceptActs, addPayment, accruals, uploadFile, downloadFile, safePath, dadataParty, dadataBank, logEvent } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast, modal, confirmBox, field, formData, pill, STATUS, saveBlob, busy } from "./ui.js?v=15";
import { today, workdaysUntil, addWorkdays, dmy, DEFAULT_HOLIDAYS } from "./calendar.js?v=15";
import { contractModel, invoiceModel, actModel, toPdf, toDocx, fileName, partyShort, SCHEME_LABEL, TRIGGER_LABEL, computeStages } from "./docs.js?v=15";
import { CONTRACT_TEMPLATE, CONTRACT_TEMPLATE_VERSION } from "./templates.js?v=15";
import { moneyWords } from "./words.js?v=15";
import { getSel, setSel, priceList, offersPage } from "./offers.js?v=15";
import { projectFromContract } from "./projects.js?v=15";
import { can } from "./access.js?v=15";
import { rolesSettings, templatesSettings } from "./settings2.js?v=15";
import { finSetup } from "./finance.js?v=15";
import { delBtn, delHead, delRec, filePaths } from "./del.js?v=15";

const clientLabel = (c) => (c ? partyShort(c) : "—");
const monthKey = (s) => String(s || "").slice(0, 7);

/* ====================== ГЛАВНАЯ ====================== */
export async function dashboard(main) {
  await autoAcceptActs();
  const [cs, invs, acts, reqs, pays, cls] = await Promise.all([
    sb.from("contracts").select("id,number,status,client_id,total,plan_end,start_date,date"),
    sb.from("invoices").select("*").in("status", ["issued", "overdue"]),
    sb.from("acts").select("*").in("status", ["sent", "accepted_default"]),
    sb.from("vs_requests").select("*").in("status", ["sent", "work"]),
    sb.from("payments").select("date,amount"),
    sb.from("clients").select("id,kind,name"),
  ]).then((r) => r.map(check));
  const myTasks = check(await sb.from("tasks").select("*").neq("status", "done").not("due_at", "is", null).lte("due_at", new Date(new Date().setHours(23, 59, 59, 999)).toISOString()).order("due_at"));
  const mine = myTasks.filter((x) => x.assignee === S.profile.person_id);
  const o = S.settings.options || {}, planN = Number(o.plan_contracts) || 2, planS = Number(o.plan_amount) || 100000;
  const cl = Object.fromEntries(cls.map((c) => [c.id, c]));
  const cmap = Object.fromEntries(cs.map((c) => [c.id, c]));
  const t = today(), mk = monthKey(t);
  const inWork = cs.filter((c) => ["signed", "work", "delivered", "support"].includes(c.status));
  const overdue = invs.filter((i) => i.due_date && i.due_date < t);
  const soonActs = acts.filter((a) => a.status === "sent" && a.deadline && workdaysUntil(a.deadline) <= 2);
  const defActs = acts.filter((a) => a.status === "accepted_default");
  const lateReq = reqs.filter((r) => r.promised_date && r.promised_date < t);
  const monthIn = pays.filter((p) => monthKey(p.date) === mk).reduce((a, p) => a + Number(p.amount), 0);
  const toPay = invs.reduce((a, i) => a + Number(i.amount), 0);
  const mC = cs.filter((c) => !["draft", "terminated"].includes(c.status) && monthKey(c.date) === mk) ;
  const M = can("dashboard", "money"), rubM = (v) => (M ? rub(v) : "—");
  const kpi = (l, v, s) => `<div class="card kpi"><div class="small muted">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const cname = (id) => clientLabel(cl[(cmap[id] || {}).client_id]);
  main.innerHTML = `
    <div class="page-head"><h1>Главная</h1><a class="btn grad" href="#/contracts/new">+ Новый договор</a></div>
    <div class="grid4">
      ${kpi("Договоров в работе", inWork.length, "подписаны, в работе или на сопровождении")}
      ${kpi("Поступило за месяц", rubM(monthIn), new Date().toLocaleString("ru-RU", { month: "long", year: "numeric" }))}
      ${kpi("Счета к оплате", rubM(toPay), `${invs.length} шт., просрочено ${overdue.length}`)}
      ${kpi("Акты на приёмке", acts.filter((a) => a.status === "sent").length, `срок истекает: ${soonActs.length}`)}
    </div>
    <div class="cols" style="margin-top:14px">
      <div class="stack">
        <div class="card flush"><div style="padding:14px 16px 4px"><div class="sec-t">Счета к оплате</div></div>
          ${invs.length ? `<div class="tw"><table class="t"><tr><th>Счёт</th><th>Клиент</th><th>Срок</th><th class="n">Сумма</th><th></th></tr>
          ${invs.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).map((i) => `<tr class="click" data-href="#/contracts/${i.contract_id}"><td>№ ${esc(i.number)} от ${d(i.date)}</td><td>${esc(cname(i.contract_id))}</td><td>${d(i.due_date)}</td><td class="n">${rubM(i.amount)}</td><td>${i.due_date && i.due_date < t ? pill("invoice", "overdue") : pill("invoice", "issued")}</td></tr>`).join("")}</table></div>` : `<div style="padding:0 16px 16px" class="muted">Неоплаченных счетов нет</div>`}
        </div>
        <div class="card flush"><div style="padding:14px 16px 4px"><div class="sec-t">Договоры в работе</div></div>
          ${inWork.length ? `<div class="tw"><table class="t"><tr><th>Договор</th><th>Клиент</th><th>Статус</th><th>Окончание</th><th class="n">Сумма</th></tr>
          ${inWork.map((c) => `<tr class="click" data-href="#/contracts/${c.id}"><td>№ ${esc(c.number)}</td><td>${esc(clientLabel(cl[c.client_id]))}</td><td>${pill("contract", c.status)}</td><td>${d(c.plan_end)}</td><td class="n">${rubM(c.total)}</td></tr>`).join("")}</table></div>` : `<div style="padding:0 16px 16px" class="muted">Пока нет договоров в работе</div>`}
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="row between"><div class="sec-t" style="margin:0">Мои задачи на сегодня</div><a class="small" href="#/tasks">Все задачи →</a></div>
          ${mine.length ? `<div class="stack" style="gap:6px;margin-top:8px">${mine.slice(0, 8).map((x) => `<div class="row between small" style="flex-wrap:nowrap"><span>${esc(x.title)}</span><span class="${new Date(x.due_at) < new Date() ? "late-t" : "muted"} nowrap">${new Date(x.due_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>`).join("")}${mine.length > 8 ? `<span class="small muted">и ещё ${mine.length - 8}</span>` : ""}</div>` : `<div class="muted small" style="margin-top:8px">На сегодня задач нет</div>`}</div>
        <div class="card"><div class="row between"><div class="sec-t" style="margin:0">План продаж месяца</div><a class="small" href="#/analytics">Аналитика →</a></div>
          <div class="small" style="margin-top:8px">Договоры: <b>${mC.length} из ${planN}</b></div><div class="bar" style="margin:4px 0 8px"><i style="width:${Math.min(100, (mC.length / planN) * 100)}%"></i></div>
          <div class="small"${M ? "" : " hidden"}>Сумма: <b>${rub(mC.reduce((a, c) => a + Number(c.total), 0))} из ${rub(planS)}</b></div><div class="bar" style="margin-top:4px"${M ? "" : " hidden"}><i style="width:${Math.min(100, (mC.reduce((a, c) => a + Number(c.total), 0) / planS) * 100)}%"></i></div></div>
        <div class="card"><div class="sec-t">Акты: срок приёмки</div>
          ${soonActs.length || defActs.length ? `<div class="stack" style="gap:8px">${soonActs.map((a) => `<a href="#/contracts/${a.contract_id}">Акт № ${esc(a.number)} — ${esc(cname(a.contract_id))}</a><span class="small muted">до ${d(a.deadline)}, осталось раб. дней: ${workdaysUntil(a.deadline)}</span>`).join("")}
          ${defActs.map((a) => `<div><a href="#/contracts/${a.contract_id}">Акт № ${esc(a.number)} — ${esc(cname(a.contract_id))}</a><div class="small" style="color:var(--warn)">Принят по умолчанию: подпишите акт в одностороннем порядке</div></div>`).join("")}</div>` : `<div class="muted">Сроков на ближайшие 2 рабочих дня нет</div>`}
        </div>
        <div class="card"><div class="sec-t">Запросы в «Включи систему»</div>
          ${reqs.length ? `<div class="stack" style="gap:8px">${reqs.map((r) => `<div><a href="#/requests">${esc(r.summary)}</a><div class="small ${r.promised_date && r.promised_date < t ? "" : "muted"}" style="${r.promised_date && r.promised_date < t ? "color:var(--bad)" : ""}">${r.blocking ? "блокирует проект · " : ""}${r.promised_date ? "обещали к " + d(r.promised_date) : "срок не назван"}</div></div>`).join("")}</div>` : `<div class="muted">Открытых запросов нет</div>`}
          ${lateReq.length ? `<div class="note" style="margin-top:10px">Просрочено продуктом: ${lateReq.length}</div>` : ""}
        </div>
      </div>
    </div>`;
  bindHref(main);
}
function bindHref(root) { $$("[data-href]", root).forEach((el) => (el.onclick = (e) => { if (e.target.closest("a,button")) return; location.hash = el.dataset.href; })); }

/* ====================== КЛИЕНТЫ ====================== */
export async function clients(main) {
  const list = check(await sb.from("clients").select("*").order("created_at", { ascending: false }));
  const cs = check(await sb.from("contracts").select("client_id,status,total"));
  const draw = (q) => {
    q = q.trim().toLowerCase();
    const rows = list.filter((c) => !q || [c.name, c.inn, c.contact_name, c.phone, c.email].join(" ").toLowerCase().includes(q));
    $("#cl", main).innerHTML = rows.length ? `<div class="tw"><table class="t"><tr><th>Клиент</th><th>ИНН</th><th>Контакт</th><th>Телефон</th><th class="n">Договоров</th><th></th></tr>
      ${rows.map((c) => `<tr class="click" data-href="#/clients/${c.id}"><td><b>${esc(clientLabel(c))}</b></td><td>${esc(c.inn)}</td><td>${esc(c.contact_name || c.signer_name)}</td><td class="nowrap">${esc(c.contact_phone || c.phone)}</td><td class="n">${cs.filter((x) => x.client_id === c.id).length}</td><td class="n">${delBtn("clients", `data-cdel="${c.id}"`)}</td></tr>`).join("")}</table></div>`
      : `<div class="empty">${list.length ? "Ничего не найдено" : "Клиентов пока нет. Нажмите «+ Клиент»."}</div>`;
    bindHref(main);
    $$("[data-cdel]", main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const c = list.find((x) => x.id === b.dataset.cdel); delClient(c, cs.filter((x) => x.client_id === c.id).length, () => clients(main)); }));
  };
  main.innerHTML = `<div class="page-head"><h1>Клиенты</h1><div class="row"><input id="q" placeholder="Поиск: название, ИНН, контакт" style="width:260px"><button class="btn primary" id="add">+ Клиент</button></div></div><div class="card flush" id="cl"></div>`;
  draw("");
  $("#q", main).oninput = (e) => draw(e.target.value);
  $("#add", main).onclick = () => clientForm(null, (c) => (location.hash = `#/clients/${c.id}`));
}

export function clientForm(c, onSaved) {
  c = c || { kind: "ИП" };
  const body = `
    <div class="row"><div class="grow">${field("ИНН", "inn", c.inn, { ph: "10 или 12 цифр" })}</div><button class="btn" type="button" data-dadata style="align-self:flex-end">Заполнить по ИНН</button></div>
    <div class="grid3">${field("Тип", "kind", c.kind, { options: ["ИП", "ООО", "другое"] })}${field("ОПФ полностью (для «другое»)", "opf", c.opf, { ph: "Акционерное общество" })}${field("КПП", "kpp", c.kpp)}</div>
    ${field("ФИО (для ИП) или название без кавычек (для организации)", "name", c.name, { req: true })}
    <div class="grid2">${field("ОГРН / ОГРНИП", "ogrn", c.ogrn)}${field("Действует на основании", "signer_basis", c.signer_basis, { ph: "листа записи ЕГРИП / Устава" })}</div>
    <div class="sec-t" style="margin:4px 0 -4px">Подписант (для организации)</div>
    <div class="grid2">${field("ФИО подписанта", "signer_name", c.signer_name)}${field("Должность", "signer_post", c.signer_post, { ph: "Генеральный директор" })}
      ${field("ФИО в родительном падеже", "signer_name_gen", c.signer_name_gen, { ph: "Иванова Ивана Ивановича" })}${field("Должность в родительном падеже", "signer_post_gen", c.signer_post_gen, { ph: "Генерального директора" })}</div>
    <div class="grid2">${field("Юридический адрес", "legal_address", c.legal_address)}${field("Почтовый адрес", "postal_address", c.postal_address)}</div>
    <div class="sec-t" style="margin:4px 0 -4px">Банк</div>
    <div class="row"><div class="grow">${field("БИК", "bik", c.bik)}</div><button class="btn" type="button" data-bank style="align-self:flex-end">Банк по БИК</button></div>
    <div class="grid3">${field("Расчётный счёт", "account", c.account)}${field("Банк", "bank", c.bank)}${field("Корр. счёт", "corr_account", c.corr_account)}</div>
    <div class="grid3">${field("Телефон", "phone", c.phone)}${field("E-mail", "email", c.email)}${field("Идентификатор ЭДО", "edo_id", c.edo_id)}</div>
    <div class="sec-t" style="margin:4px 0 -4px">Контакт для работы</div>
    <div class="grid4">${field("ФИО", "contact_name", c.contact_name)}${field("Телефон", "contact_phone", c.contact_phone)}${field("E-mail", "contact_email", c.contact_email)}${field("Часовой пояс", "contact_tz", c.contact_tz, { ph: "МСК+4" })}</div>
    ${field("Комментарий", "comment", c.comment, { rows: 2 })}`;
  modal({
    title: c.id ? "Клиент" : "Новый клиент", body, wide: true,
    footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-save>Сохранить</button>`,
    onMount: (el, close) => {
      el.querySelector("[data-dadata]").onclick = async (e) => {
        const inn = el.querySelector("[name=inn]").value.trim();
        if (!inn) return toast("Введите ИНН", true);
        busy(e.target, true, "Ищу…");
        try { const x = await dadataParty(inn); for (const [k, v] of Object.entries(x)) { const f = el.querySelector(`[name=${k}]`); if (f && v) f.value = v; } toast("Реквизиты заполнены"); }
        catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
      };
      el.querySelector("[data-bank]").onclick = async (e) => {
        const bik = el.querySelector("[name=bik]").value.trim();
        if (!bik) return toast("Введите БИК", true);
        busy(e.target, true, "Ищу…");
        try { const x = await dadataBank(bik); el.querySelector("[name=bank]").value = x.bank; el.querySelector("[name=corr_account]").value = x.corr_account; }
        catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
      };
      el.querySelector("[data-save]").onclick = async (e) => {
        const v = formData(el);
        if (!v.name) return toast("Укажите ФИО или название", true);
        if (!v.signer_basis) v.signer_basis = v.kind === "ИП" ? "листа записи ЕГРИП" : "Устава";
        busy(e.target, true, "Сохраняю…");
        try {
          const r = c.id ? await sb.from("clients").update(v).eq("id", c.id).select().single() : await sb.from("clients").insert(v).select().single();
          const saved = check(r); close(); toast("Клиент сохранён"); onSaved && onSaved(saved);
        } catch (err) { toast(err.message, true); busy(e.target, false); }
      };
    },
  });
}

function delClient(c, nContracts, done) {
  if (nContracts) return toast(`У клиента ${nContracts} договор(а) — сначала удалите их в «Документации → Договоры».`, true);
  return delRec({ table: "clients", id: c.id, what: `клиента «${clientLabel(c)}»`, warn: "Запросы в ВС клиента тоже удалятся; сделки и проекты останутся без привязки.", done });
}
export async function clientCard(main, id) {
  const c = check(await sb.from("clients").select("*").eq("id", id).single());
  const [cs, reqs] = await Promise.all([
    sb.from("contracts").select("*").eq("client_id", id).order("date", { ascending: false }),
    sb.from("vs_requests").select("*").eq("client_id", id).order("date", { ascending: false }),
  ]).then((r) => r.map(check));
  const kv = (k, v) => (v ? `<div><div class="small muted">${k}</div><div>${esc(v)}</div></div>` : "");
  main.innerHTML = `
    <div class="page-head"><div><a href="#/clients" class="small">← Клиенты</a><h1>${esc(clientLabel(c))}</h1></div>
      <div class="row">${delHead("clients")}<button class="btn" id="edit">Изменить</button><a class="btn grad" href="#/contracts/new/${c.id}">+ Договор</a></div></div>
    <div class="cols">
      <div class="stack">
        <div class="card"><div class="sec-t">Реквизиты</div><div class="grid2">
          ${kv("ИНН / КПП", [c.inn, c.kpp].filter(Boolean).join(" / "))}${kv(c.kind === "ИП" ? "ОГРНИП" : "ОГРН", c.ogrn)}
          ${kv("Подписант", c.kind === "ИП" ? c.name : [c.signer_post, c.signer_name].filter(Boolean).join(" "))}${kv("Основание", c.signer_basis)}
          ${kv("Юридический адрес", c.legal_address)}${kv("Почтовый адрес", c.postal_address)}
          ${kv("Расчётный счёт", c.account)}${kv("Банк", [c.bank, c.bik && "БИК " + c.bik].filter(Boolean).join(", "))}
          ${kv("Телефон", c.phone)}${kv("E-mail", c.email)}${kv("ЭДО", c.edo_id)}
        </div></div>
        <div class="card flush"><div style="padding:14px 16px 4px"><div class="sec-t">Договоры</div></div>
          ${cs.length ? `<div class="tw"><table class="t"><tr><th>Договор</th><th>Пакет</th><th>Статус</th><th class="n">Сумма</th></tr>${cs.map((x) => `<tr class="click" data-href="#/contracts/${x.id}"><td>№ ${esc(x.number)} от ${d(x.date)}</td><td>${esc(x.package_name || "индивидуальный")}</td><td>${pill("contract", x.status)}</td><td class="n">${rub(x.total)}</td></tr>`).join("")}</table></div>` : `<div style="padding:0 16px 16px" class="muted">Договоров нет</div>`}
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="sec-t">Контакт для работы</div>${c.contact_name || c.contact_phone ? `<div>${esc(c.contact_name)}</div><div class="small muted">${esc([c.contact_phone, c.contact_email, c.contact_tz].filter(Boolean).join(" · "))}</div>` : `<div class="muted">Не указан</div>`}
          ${c.comment ? `<div class="small" style="margin-top:10px;white-space:pre-wrap">${esc(c.comment)}</div>` : ""}</div>
        <div class="card"><div class="row between"><div class="sec-t" style="margin:0">Запросы в ВС</div><button class="btn sm" id="req">+ Запрос</button></div>
          ${reqs.length ? `<div class="stack" style="gap:8px;margin-top:10px">${reqs.map((r) => `<div>${pill("vs", r.status)} ${esc(r.summary)}<div class="small muted">${d(r.date)}${r.blocking ? " · блокирует" : ""}</div></div>`).join("")}</div>` : `<div class="muted" style="margin-top:10px">Нет</div>`}
        </div>
      </div>
    </div>`;
  bindHref(main);
  $("#edit", main).onclick = () => clientForm(c, () => clientCard(main, id));
  const dr = $("#delrec", main); if (dr) dr.onclick = () => delClient(c, cs.length, () => (location.hash = "#/clients"));
  $("#req", main).onclick = () => requestForm({ client_id: id }, () => clientCard(main, id));
}

/* ====================== ДОГОВОРЫ: СПИСОК ====================== */
export async function contracts(main) {
  const [cs, cls, pays] = await Promise.all([
    sb.from("contracts").select("*").order("date", { ascending: false }).order("seq", { ascending: false }),
    sb.from("clients").select("id,kind,name"),
    sb.from("payments").select("contract_id,amount"),
  ]).then((r) => r.map(check));
  const cl = Object.fromEntries(cls.map((c) => [c.id, c]));
  main.innerHTML = `<div class="page-head"><h1>Договоры</h1><a class="btn grad" href="#/contracts/new">+ Новый договор</a></div>
    <div class="filters">
      <select id="fs"><option value="">Все статусы</option>${Object.entries(STATUS.contract).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <select id="fc"><option value="">Все клиенты</option>${cls.map((c) => `<option value="${c.id}">${esc(clientLabel(c))}</option>`).join("")}</select>
      <select id="fp"><option value="">Все пакеты</option>${[...new Set(cs.map((c) => c.package_name || "индивидуальный"))].map((p) => `<option>${esc(p)}</option>`).join("")}</select>
    </div><div class="card flush" id="list"></div>`;
  const draw = () => {
    const fs = $("#fs", main).value, fc = $("#fc", main).value, fp = $("#fp", main).value;
    const rows = cs.filter((c) => (!fs || c.status === fs) && (!fc || c.client_id === fc) && (!fp || (c.package_name || "индивидуальный") === fp));
    $("#list", main).innerHTML = rows.length ? `<div class="tw"><table class="t"><tr><th>Номер</th><th>Клиент</th><th>Пакет</th><th>Оплата</th><th>Статус</th><th class="n">Сумма</th><th class="n">Оплачено</th></tr>
      ${rows.map((c) => { const paid = pays.filter((p) => p.contract_id === c.id).reduce((a, p) => a + Number(p.amount), 0); return `<tr class="click" data-href="#/contracts/${c.id}"><td class="nowrap"><b>№ ${esc(c.number)}</b><div class="small muted">${d(c.date)}</div></td><td>${esc(clientLabel(cl[c.client_id]))}</td><td>${esc(c.package_name || "индивидуальный")}</td><td class="small">${SCHEME_LABEL[c.scheme]}</td><td>${pill("contract", c.status)}</td><td class="n">${rub(c.total)}</td><td class="n">${paid ? rub(paid) : "—"}</td></tr>`; }).join("")}</table></div>`
      : `<div class="empty">${cs.length ? "Ничего не найдено" : "Договоров пока нет. Нажмите «+ Новый договор»."}</div>`;
    bindHref(main);
  };
  ["#fs", "#fc", "#fp"].forEach((s) => ($(s, main).onchange = draw));
  draw();
}

/* ====================== ДОГОВОРЫ: ВКЛАДКИ ====================== */
export async function contractsHub(main, tab = "offers") {
  const TABS = [["offers", "КП", "offers"], ["list", "Договоры", "contracts"], ["invoices", "Счета", "docs"], ["acts", "Акты", "docs"]].filter((t) => can(t[2], "see"));
  main.innerHTML = `<div class="page-head"><h1>Документация</h1></div><div class="set-tabs">${TABS.map(([k, l]) => `<a href="#/contracts/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</div><div class="hub-sub" id="hs"><div class="boot">Загрузка…</div></div>`;
  const sub = $("#hs", main);
  if (tab === "list") return contracts(sub);
  if (tab === "invoices") return invoices(sub);
  if (tab === "acts") return acts(sub);
  return offersPage(sub);
}

/* ====================== МАСТЕР ДОГОВОРА ====================== */
const defaultParticipants = () => (S.settings.shares || []).map((s) => ({ fn: s.fn, label: s.label, pct: s.pct, person_id: s.fn === "company" ? null : (S.profile.person_id && ["meeting", "sale"].includes(s.fn) ? S.profile.person_id : null) }));

export async function wizard(main, clientId) {
  const cls = check(await sb.from("clients").select("*").order("name"));
  const ex = S.settings.executor || {};
  const W = {
    step: clientId ? 2 : 1,
    c: { client_id: clientId || null, date: today(), city: ex.city || "г. Санкт-Петербург", package_id: null, package_name: "", services: [], price: 0, scheme: "prepay", discount_pct: 0, months_work: 1, months_support: 0, acceptance_days: (S.settings.options && S.settings.options.acceptance_days) || 5, participants: defaultParticipants(), status: "draft", template_version: CONTRACT_TEMPLATE_VERSION },
  };
  const STEPS = ["Клиент", "Пакет", "Услуги", "Оплата и сроки", "Проверка"];
  const sel = getSel();
  if (sel && sel.ids && sel.ids.length) {
    const pk0 = S.packages.find((p) => p.id === sel.package_id);
    if (pk0) Object.assign(W.c, { package_id: pk0.id, package_name: pk0.name, price: Number(pk0.price), months_work: Number(pk0.months_work), months_support: Number(pk0.months_support), scheme: pk0.schemes[0] });
    else W.indiv = true;
    W.c.services = S.services.filter((s) => sel.ids.includes(s.id)).map((s) => ({ service_id: s.id, name: s.name, description: s.description, term: s.term, result: s.result_criteria, price: Number(s.price) || 0, days: s.days, stage: /^сопровожд/i.test(s.name) ? 2 : 1 }));
    if (!pk0) W.c.price = W.c.services.reduce((a, s) => a + s.price, 0);
    W.fromPrice = true;
  }
  const pkActive = S.packages.filter((p) => p.active);
  const svcFrom = (s, stage) => ({ service_id: s.id, name: s.name, description: s.description, term: s.term, result: s.result_criteria, price: Number(s.price) || 0, days: s.days, stage: stage || (/^сопровожд/i.test(s.name) ? 2 : 1) });

  const draw = () => {
    const c = W.c;
    let body = "";
    if (W.step === 1) {
      body = `<div class="row" style="margin-bottom:10px"><input id="cq" placeholder="Найти клиента: название или ИНН" class="grow"><button class="btn" id="newcl">+ Новый клиент</button></div>
        <div class="pick" id="clp">${cls.map((x) => `<button data-cl="${x.id}" aria-pressed="${c.client_id === x.id}"><b>${esc(clientLabel(x))}</b><span class="small muted">ИНН ${esc(x.inn || "—")}</span></button>`).join("") || `<div class="muted">Клиентов нет — создайте нового</div>`}</div>`;
    } else if (W.step === 2) {
      body = `<div class="pick">${pkActive.map((p) => `<button data-pk="${p.id}" aria-pressed="${c.package_id === p.id}"><b>${esc(p.name)}</b><span class="price">${rub(p.price)}</span><span class="small muted">${esc(p.term_text || `${num(p.months_work)} мес. работ`)}${Number(p.months_support) ? ` + ${num(p.months_support)} мес. сопровождения` : ""}</span><span class="small">${esc(p.summary)}</span></button>`).join("")}
        <button data-pk="" aria-pressed="${c.package_id === null && W.indiv === true}"><b>Индивидуальный</b><span class="small muted">Услуги и цену выбираете сами</span></button></div>`;
    } else if (W.step === 3) {
      body = `<p class="muted small" style="margin-top:0">Эти услуги попадут в раздел 2 договора: название, что входит, срок и результат. Править можно прямо здесь — изменения касаются только этого договора.</p>
        <div id="svl">${c.services.map((s, i) => `<div class="svc-row" data-i="${i}">
          <span class="muted">${i + 1}.</span>
          <div class="fields"><input data-k="name" value="${esc(s.name)}" placeholder="Название"><textarea data-k="description" rows="2" placeholder="Что входит">${esc(s.description)}</textarea>
            <input data-k="term" value="${esc(s.term)}" placeholder="Срок оказания"><textarea data-k="result" rows="2" placeholder="Результат — что считается выполненным">${esc(s.result)}</textarea></div>
          <label class="f">Этап<select data-k="stage"><option value="1"${Number(s.stage) !== 2 ? " selected" : ""}>1 · внедрение</option><option value="2"${Number(s.stage) === 2 ? " selected" : ""}>2 · сопровождение</option></select></label>
          <label class="f">Цена, ₽<input data-k="price" type="number" min="0" value="${esc(s.price || "")}" placeholder="0"></label>
          <button class="btn ghost danger sm" data-del="${i}" aria-label="Убрать">✕</button></div>`).join("") || `<div class="empty">Услуг нет — добавьте из справочника</div>`}</div>
        <div class="card" style="background:#fbfaf7;margin-top:12px"><div class="sec-t">Добавить из прайса — нажмите на услугу</div>
          ${[...new Set(S.services.filter((s) => s.active).map((s) => s.category || "Прочее"))].map((cat) => `<div class="small muted" style="margin:8px 0 4px">${esc(cat)}</div><div class="chips">${S.services.filter((s) => s.active && (s.category || "Прочее") === cat).map((s) => `<button class="chip" data-tg="${s.id}" aria-pressed="${c.services.some((x) => x.service_id === s.id)}">${esc(s.name)}</button>`).join("")}</div>`).join("")}
          <div class="row" style="margin-top:10px"><button class="btn sm" id="addblank">+ Своя услуга</button></div></div>`;
    } else if (W.step === 4) {
      const pk = S.packages.find((p) => p.id === c.package_id);
      const schemes = pk ? pk.schemes : ["prepay", "discount", "tranches"];
      recalc(c);
      const sumPct = c.participants.reduce((a, p) => a + Number(p.pct || 0), 0);
      body = `<div class="grid4">${field("Дата договора", "date", c.date, { type: "date" })}${field("Город", "city", c.city)}${field("Срок работ, мес.", "months_work", c.months_work, { type: "number", attrs: 'step="0.5" min="0"' })}${field("Сопровождение, мес.", "months_support", c.months_support, { type: "number", attrs: 'step="0.5" min="0"' })}</div>
        <div class="grid3">${field("Цена до скидки, ₽", "price", c.price, { type: "number", attrs: 'min="0"' })}${field("Приёмка акта, раб. дней", "acceptance_days", c.acceptance_days, { type: "number", attrs: 'min="1"' })}<div></div></div>
        <div><div class="sec-t">Схема оплаты</div><div class="pick">${schemes.map((s) => `<button data-sch="${s}" aria-pressed="${c.scheme === s}"><b>${SCHEME_LABEL[s]}</b><span class="small muted">${s === "prepay" ? "вся сумма в течение 3 рабочих дней после подписания" : s === "discount" ? `скидка ${num(pk ? pk.discount_pct : 20)}% при оплате сразу` : "предоплата 40%, 30% после акта по этапу 1, 30% после акта по этапу 2"}</span></button>`).join("")}</div></div>
        <div class="card" style="background:#fbfaf7"><div class="row between"><b>Итого по договору</b><b style="font:700 20px var(--display)">${rub(c.total)}</b></div><div class="small muted">${esc(moneyWords(c.total))}</div>
          ${c.tranches.length > 1 ? `<div class="small" style="margin-top:6px">${c.tranches.map((t) => `${t.n}) ${t.pct}% — ${rub(t.amount)} (${TRIGGER_LABEL[t.trigger]})`).join("<br>")}</div>` : ""}
          <div class="small muted" style="margin-top:6px">Этапы: ${c.stages.map((s) => `${s.n} «${s.name}» — ${rub(s.amount)}`).join("; ")}</div></div>
        <div><div class="sec-t">Участники сделки и доли</div>
          <div class="tw"><table class="t"><tr><th>Функция</th><th>Исполнитель</th><th class="n">Доля, %</th></tr>
          ${c.participants.map((p, i) => `<tr><td>${esc(p.label)}</td><td>${p.fn === "company" ? `<span class="muted">компания</span>` : `<select data-pp="${i}" data-k="person_id"><option value="">— не назначен —</option>${S.people.filter((x) => x.active).map((x) => `<option value="${x.id}"${x.id === p.person_id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`}</td><td class="n" style="width:110px"><input data-pp="${i}" data-k="pct" type="number" step="0.5" min="0" max="100" value="${esc(p.pct)}"></td></tr>`).join("")}
          <tr><td colspan="2"><b>Сумма долей</b></td><td class="n"><b style="color:${sumPct === 100 ? "var(--good)" : "var(--bad)"}">${sumPct}%</b></td></tr></table></div>
          ${sumPct !== 100 ? `<div class="note" style="margin-top:8px">Сумма долей должна быть ровно 100%.</div>` : ""}</div>`;
    } else {
      recalc(c);
      const cl = cls.find((x) => x.id === c.client_id);
      body = `<div class="grid2">
          <div class="card"><div class="sec-t">Стороны</div><div><b>Заказчик:</b> ${esc(clientLabel(cl))}</div><div class="small muted">ИНН ${esc(cl && cl.inn || "—")}</div>
            ${cl && (!cl.inn || !cl.legal_address || !cl.account) ? `<div class="note" style="margin-top:8px">У клиента не хватает реквизитов (ИНН, адрес или счёт) — в договоре будут пропуски. <a href="#" id="fixcl">Дополнить</a></div>` : ""}</div>
          <div class="card"><div class="sec-t">Условия</div><div>${esc(c.package_name || "Индивидуальный пакет")} · ${SCHEME_LABEL[c.scheme]}</div><div><b>${rub(c.total)}</b> · работ ${num(c.months_work)} мес.${Number(c.months_support) ? `, сопровождение ${num(c.months_support)} мес.` : ""}</div><div class="small muted">Дата ${d(c.date)}, ${esc(c.city)}</div></div>
        </div>
        <div class="card"><div class="sec-t">Услуги (${c.services.length})</div><ol style="margin:0;padding-left:20px">${c.services.map((s) => `<li><b>${esc(s.name)}</b> <span class="muted small">— этап ${s.stage}; результат: ${esc(s.result)}</span></li>`).join("")}</ol></div>
        <div class="row"><button class="btn" id="preview">Посмотреть PDF</button><span class="small muted">Номер договора присвоится при создании.</span></div>`;
    }
    const canNext = (W.step === 1 && c.client_id) || (W.step === 2 && (c.package_id || W.indiv)) || (W.step === 3 && c.services.length) || (W.step === 4 && c.participants.reduce((a, p) => a + Number(p.pct || 0), 0) === 100 && c.total > 0) || W.step === 5;
    main.innerHTML = `<div class="page-head"><div><a href="#/contracts/list" class="small">← Договоры</a><h1>Новый договор</h1></div></div>
      <div class="steps">${STEPS.map((s, i) => `<span class="${i + 1 === W.step ? "on" : i + 1 < W.step ? "done" : ""}">${i + 1}. ${s}</span>`).join("")}</div>
      <div class="card stack" id="wz">${body}</div>
      <div class="row between" style="margin-top:14px"><button class="btn" id="back"${W.step === 1 ? " disabled" : ""}>← Назад</button>
        ${W.step < 5 ? `<button class="btn primary" id="next"${canNext ? "" : " disabled"}>Далее →</button>` : `<button class="btn grad" id="create">Создать договор и сформировать файлы</button>`}</div>`;
    bind();
  };

  const bind = () => {
    const c = W.c, wz = $("#wz", main);
    $("#back", main).onclick = () => { W.step--; draw(); };
    const nx = $("#next", main); if (nx) nx.onclick = () => { W.step++; draw(); };
    if (W.step === 1) {
      $$("[data-cl]", wz).forEach((b) => (b.onclick = () => { c.client_id = b.dataset.cl; W.step = W.fromPrice ? 3 : 2; draw(); }));
      $("#cq", wz).oninput = (e) => { const q = e.target.value.toLowerCase(); $$("[data-cl]", wz).forEach((b) => (b.style.display = b.textContent.toLowerCase().includes(q) ? "" : "none")); };
      $("#newcl", wz).onclick = () => clientForm(null, (x) => { cls.push(x); c.client_id = x.id; W.step = 2; draw(); });
    }
    if (W.step === 2) $$("[data-pk]", wz).forEach((b) => (b.onclick = () => {
      const pk = S.packages.find((p) => p.id === b.dataset.pk);
      if (pk) {
        Object.assign(c, { package_id: pk.id, package_name: pk.name, price: Number(pk.price), months_work: Number(pk.months_work), months_support: Number(pk.months_support), scheme: pk.schemes.includes(c.scheme) ? c.scheme : pk.schemes[0] });
        c.services = S.services.filter((s) => s.active && (s.packages || []).includes(pk.id)).map((s) => svcFrom(s));
        W.indiv = false;
      } else { Object.assign(c, { package_id: null, package_name: "", price: 0 }); c.services = []; W.indiv = true; }
      W.step = 3; draw();
    }));
    if (W.step === 3) {
      $$(".svc-row", wz).forEach((row) => {
        const i = Number(row.dataset.i);
        $$("[data-k]", row).forEach((inp) => (inp.oninput = inp.onchange = () => { const k = inp.dataset.k; c.services[i][k] = k === "price" || k === "stage" ? Number(inp.value) || 0 : inp.value; if (!c.package_id) c.price = 0; }));
      });
      $$("[data-del]", wz).forEach((b) => (b.onclick = () => { c.services.splice(Number(b.dataset.del), 1); draw(); }));
      $$("[data-tg]", wz).forEach((b) => (b.onclick = () => { const id = b.dataset.tg; const i = c.services.findIndex((x) => x.service_id === id); if (i >= 0) c.services.splice(i, 1); else c.services.push(svcFrom(S.services.find((x) => x.id === id))); if (!c.package_id) c.price = 0; draw(); }));
      $("#addblank", wz).onclick = () => { c.services.push({ name: "", description: "", term: "В течение срока оказания Услуг", result: "", price: 0, stage: 1 }); draw(); };
      $("#next", main).onclick = () => {
        const bad = c.services.find((s) => !s.name.trim() || !s.result.trim());
        if (bad) return toast("У каждой услуги должны быть название и результат", true);
        if (!c.package_id) c.price = c.services.reduce((a, s) => a + (Number(s.price) || 0), 0);
        W.step = 4; draw();
      };
    }
    if (W.step === 4) {
      $$("[name]", wz).forEach((inp) => (inp.onchange = () => { const v = formData(wz); Object.assign(c, { date: v.date, city: v.city, months_work: v.months_work || 0, months_support: v.months_support || 0, price: v.price || 0, acceptance_days: v.acceptance_days || 5 }); draw(); }));
      $$("[data-sch]", wz).forEach((b) => (b.onclick = () => { c.scheme = b.dataset.sch; const pk = S.packages.find((p) => p.id === c.package_id); c.discount_pct = c.scheme === "discount" ? Number(pk ? pk.discount_pct : 20) : 0; draw(); }));
      $$("[data-pp]", wz).forEach((inp) => (inp.onchange = () => { const p = c.participants[Number(inp.dataset.pp)]; p[inp.dataset.k] = inp.dataset.k === "pct" ? Number(inp.value) || 0 : inp.value || null; draw(); }));
    }
    if (W.step === 5) {
      const fx = $("#fixcl", wz); if (fx) fx.onclick = (e) => { e.preventDefault(); const cl = cls.find((x) => x.id === c.client_id); clientForm(cl, (x) => { Object.assign(cl, x); draw(); }); };
      $("#preview", wz).onclick = async (e) => {
        busy(e.target, true, "Собираю…");
        try { const cl = cls.find((x) => x.id === c.client_id); const blob = await toPdf(contractModel({ ...c, number: "___" }, cl, S.settings)); window.open(URL.createObjectURL(blob), "_blank"); }
        catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
      };
      $("#create", main).onclick = async (e) => {
        busy(e.target, true, "Создаю…");
        try {
          recalc(c);
          const saved = await createContract({ ...c });
          setSel(null);
          const cl = cls.find((x) => x.id === c.client_id);
          try { await generateContractDocs(saved, cl, true); toast(`Договор № ${saved.number} создан`); }
          catch (err) { toast(`Договор № ${saved.number} создан, но файлы не собрались: ${err.message}. Нажмите «Сформировать договор».`, true); }
          location.hash = `#/contracts/${saved.id}`;
        } catch (err) { toast(err.message, true); busy(e.target, false); }
      };
    }
  };
  draw();
}
const num = (n) => String(Number(n) || 0).replace(".", ",");

/* ====================== ДОКУМЕНТЫ ====================== */
async function buildBoth(model) { const [pdf, docx] = await Promise.all([toPdf(model), toDocx(model)]); return { pdf, docx }; }

export async function generateContractDocs(c, client, download = false) {
  const model = contractModel(c, client, S.settings);
  const { pdf, docx } = await buildBoth(model);
  const base = fileName("Договор", c.number, client);
  const key = `contracts/${c.id}/contract_${safePath(c.number)}`;
  await uploadFile(`${key}.pdf`, pdf, "application/pdf");
  await uploadFile(`${key}.docx`, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const files = Object.assign({}, c.files || {}, { pdf: `${key}.pdf`, docx: `${key}.docx`, name: base, generated_at: new Date().toISOString(), template: (S.settings.templates && S.settings.templates.version) || CONTRACT_TEMPLATE_VERSION });
  await updateContract(c.id, { files }, "Сформированы файлы договора (PDF и Word)");
  if (download) saveBlob(pdf, base + ".pdf");
  return files;
}
export async function generateDoc(kind, rec, c, client, table) {
  const model = kind === "Счёт" ? invoiceModel(rec, c, client, S.settings) : actModel(rec, c, client, S.settings);
  const { pdf, docx } = await buildBoth(model);
  const base = fileName(kind, rec.number, client);
  const key = `contracts/${c.id}/${table === "invoices" ? "invoice" : "act"}_${rec.year}_${rec.seq}`;
  await uploadFile(`${key}.pdf`, pdf, "application/pdf");
  await uploadFile(`${key}.docx`, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const files = Object.assign({}, rec.files || {}, { pdf: `${key}.pdf`, docx: `${key}.docx`, name: base });
  check(await sb.from(table).update({ files }).eq("id", rec.id));
  return files;
}
/** Кнопки скачивания -> прямые ссылки на файл (Chrome не блокирует такие загрузки). */
async function linkify(root) {
  const btns = $$("[data-dl]", root);
  btns.forEach((b) => (b.onclick = () => dl(b.dataset.dl, b.dataset.name)));
  await Promise.all(btns.map(async (b) => {
    const { data } = await sb.storage.from("docs").createSignedUrl(b.dataset.dl, 3600, { download: b.dataset.name });
    if (!data || !data.signedUrl) return;
    const a = document.createElement("a");
    a.className = b.className; a.textContent = b.textContent; a.href = data.signedUrl; a.rel = "noopener"; a.target = "_blank";
    b.parentNode.insertBefore(a, b); b.parentNode.removeChild(b);
  }));
}
async function dl(path, name) { try { saveBlob(await downloadFile(path), name); } catch (e) { toast("Файл не найден: " + e.message, true); } }
function pickFile(accept) {
  return new Promise((res) => { const i = document.createElement("input"); i.type = "file"; i.accept = accept || ".pdf,.jpg,.jpeg,.png"; i.onchange = () => res(i.files[0] || null); i.click(); });
}

/* ====================== КАРТОЧКА ДОГОВОРА ====================== */
export async function contractCard(main, id) {
  await autoAcceptActs();
  const c = check(await sb.from("contracts").select("*").eq("id", id).single());
  const [client, invs, acts, pays, evs, reqs] = await Promise.all([
    sb.from("clients").select("*").eq("id", c.client_id).single(),
    sb.from("invoices").select("*").eq("contract_id", id).order("seq"),
    sb.from("acts").select("*").eq("contract_id", id).order("seq"),
    sb.from("payments").select("*").eq("contract_id", id).order("date"),
    sb.from("contract_events").select("*").eq("contract_id", id).order("at", { ascending: false }),
    sb.from("vs_requests").select("*").eq("contract_id", id).order("date", { ascending: false }),
  ]).then((r) => r.map(check));
  if (!c.stages || !c.stages.length) c.stages = computeStages(c);
  const paid = pays.reduce((a, p) => a + Number(p.amount), 0);
  const locked = !["draft", "sent"].includes(c.status);
  const acc = accruals(c, pays);
  const mine = S.profile.person_id;
  const t = today();
  const reload = () => contractCard(main, id);

  const trRows = (c.tranches || []).map((tr) => {
    const inv = invs.filter((i) => i.tranche === tr.n && i.status !== "cancelled").slice(-1)[0];
    return `<tr><td>${tr.n}. ${tr.pct}%<div class="small muted">${esc(TRIGGER_LABEL[tr.trigger] || "")}</div></td><td class="n">${rub(tr.amount)}</td>
      <td>${inv ? `Счёт № ${esc(inv.number)} от ${d(inv.date)}<div class="small">${inv.status === "paid" ? pill("invoice", "paid") + " " + d(inv.paid_at) : inv.due_date && inv.due_date < t ? pill("invoice", "overdue") : pill("invoice", "issued") + ` <span class="muted">до ${d(inv.due_date)}</span>`}</div>` : `<span class="muted">счёт не выставлен</span>`}</td>
      <td class="n nowrap">${inv ? `${inv.files && inv.files.pdf ? `<button class="btn sm" data-dl="${esc(inv.files.pdf)}" data-name="${esc(inv.files.name)}.pdf">PDF</button> <button class="btn sm" data-dl="${esc(inv.files.docx)}" data-name="${esc(inv.files.name)}.docx">Word</button>` : ""} ${inv.status !== "paid" ? `<button class="btn sm primary" data-pay="${inv.id}">Оплачен</button>` : ""}` : `<button class="btn sm" data-inv="${tr.n}">Выставить счёт</button>`}</td></tr>`;
  }).join("");

  const stRows = c.stages.map((st) => {
    const act = acts.filter((a) => a.stage === st.n).slice(-1)[0];
    let actCell = `<span class="muted">акт не создан</span>`, actBtns = `<button class="btn sm" data-act="${st.n}">Создать акт</button>`;
    if (act) {
      const left = act.deadline ? workdaysUntil(act.deadline) : null;
      actCell = `Акт № ${esc(act.number)} от ${d(act.date)}<div class="small">${pill("act", act.status)} ${act.status === "sent" ? `<span class="muted">приёмка до ${d(act.deadline)} (${left >= 0 ? "осталось " + left + " раб. дн." : "срок истёк"})</span>` : act.sent_at ? `<span class="muted">отправлен ${d(act.sent_at)}${act.sent_via ? ", " + esc(act.sent_via) : ""}</span>` : ""}</div>`;
      actBtns = `${act.files && act.files.pdf ? `<button class="btn sm" data-dl="${esc(act.files.pdf)}" data-name="${esc(act.files.name)}.pdf">PDF</button> <button class="btn sm" data-dl="${esc(act.files.docx)}" data-name="${esc(act.files.name)}.docx">Word</button>` : ""}
        ${act.status === "draft" ? `<button class="btn sm primary" data-send="${act.id}">Отправлен</button>` : ""}
        ${["sent", "accepted_default", "rejected"].includes(act.status) ? `<button class="btn sm" data-asign="${act.id}">Подписан</button> <button class="btn sm ghost" data-areject="${act.id}">Отказ</button>` : ""}
        ${act.files && act.files.scan ? `<button class="btn sm" data-dl="${esc(act.files.scan)}" data-name="Акт_${esc(act.number)}_скан">Скан</button>` : `<button class="btn sm ghost" data-ascan="${act.id}">Загрузить скан</button>`}`;
    }
    return `<tr><td>${st.n}. ${esc(st.name)}<div class="small muted">${c.services.filter((s) => (Number(s.stage) || 1) === st.n).length} усл.</div></td><td class="n">${rub(st.amount)}</td><td>${actCell}</td><td class="n nowrap">${actBtns}</td></tr>`;
  }).join("");

  const sumPct = (c.participants || []).reduce((a, p) => a + Number(p.pct || 0), 0);
  const partRows = (c.participants || []).map((p, i) => {
    const got = acc.filter((a) => a.fn === p.fn && a.person_id === p.person_id).reduce((a, x) => a + x.amount, 0);
    const companyGot = p.fn === "company" ? Math.round(paid * Number(p.pct || 0)) / 100 : got;
    const show = isOwner() || p.person_id === mine;
    return `<tr><td>${esc(p.label)}</td><td>${p.fn === "company" ? `<span class="muted">компания</span>` : isOwner() ? `<select data-pp="${i}" data-k="person_id"><option value="">— не назначен —</option>${S.people.map((x) => `<option value="${x.id}"${x.id === p.person_id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : esc(personName(p.person_id))}</td>
      <td class="n" style="width:100px">${isOwner() ? `<input data-pp="${i}" data-k="pct" type="number" step="0.5" min="0" max="100" value="${esc(p.pct)}">` : esc(p.pct) + "%"}</td>
      <td class="n">${show ? rub(Number(c.total) * Number(p.pct || 0) / 100) : "—"}</td><td class="n">${show ? rub(companyGot) : "—"}</td></tr>`;
  }).join("");

  main.innerHTML = `
    <div class="page-head"><div><a href="#/contracts/list" class="small">← Договоры</a><h1>Договор № ${esc(c.number)} ${pill("contract", c.status)}</h1>
      <div class="muted"><a href="#/clients/${client.id}">${esc(clientLabel(client))}</a> · ${esc(c.package_name || "индивидуальный")} · ${SCHEME_LABEL[c.scheme]} · от ${d(c.date)}</div></div>
      <div class="row">${c.files && c.files.pdf ? `<button class="btn" data-dl="${esc(c.files.pdf)}" data-name="${esc(c.files.name)}.pdf">Договор PDF</button><button class="btn" data-dl="${esc(c.files.docx)}" data-name="${esc(c.files.name)}.docx">Договор Word</button>` : ""}<button class="btn primary" id="gen">${c.files && c.files.pdf ? "Пересобрать" : "Сформировать"} договор</button><button class="btn" id="proj">Проект и график</button>${delHead("contracts")}</div></div>
    <div class="card"><div class="sec-t">Статус</div><div class="statusbar">${Object.entries(STATUS.contract).map(([k, [l]]) => `<button data-st="${k}" aria-current="${c.status === k}">${l}</button>`).join("")}</div></div>
    <div class="grid4" style="margin-top:14px">
      <div class="card kpi"><div class="small muted">Сумма договора</div><div class="v">${rub(c.total)}</div><div class="s">${Number(c.discount_pct) ? `скидка ${num(c.discount_pct)}% от ${rub(c.price)}` : "без скидки"}</div></div>
      <div class="card kpi"><div class="small muted">Оплачено</div><div class="v">${rub(paid)}</div><div class="s">осталось ${rub(Math.max(0, c.total - paid))}</div></div>
      <div class="card kpi"><div class="small muted">Начало услуг</div><div class="v">${d(c.start_date)}</div><div class="s">${c.first_paid_at ? "первая оплата " + d(c.first_paid_at) : "после первой оплаты"}</div></div>
      <div class="card kpi"><div class="small muted">Окончание (план)</div><div class="v">${d(c.plan_end)}</div><div class="s">работ ${num(c.months_work)} мес.${Number(c.months_support) ? ` + сопр. ${num(c.months_support)}` : ""}</div></div>
    </div>
    <div class="cols" style="margin-top:14px"><div class="stack">
      <div class="card flush"><div style="padding:14px 16px 4px" class="row between"><div class="sec-t" style="margin:0">Оплата и счета</div><button class="btn sm" id="addpay">+ Поступление</button></div>
        <div class="tw"><table class="t"><tr><th>Платёж</th><th class="n">Сумма</th><th>Счёт</th><th></th></tr>${trRows}</table></div>
        ${pays.length ? `<div style="padding:8px 16px 14px" class="small"><b>Поступления:</b> ${pays.map((p) => `<span class="pay-i">${d(p.date)} — ${rub(p.amount)}${p.comment ? " (" + esc(p.comment) + ")" : ""}${delBtn("contracts", `data-paydel="${p.id}"`)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="card flush"><div style="padding:14px 16px 4px"><div class="sec-t">Этапы и акты · приёмка ${c.acceptance_days} раб. дн.</div></div>
        <div class="tw"><table class="t"><tr><th>Этап</th><th class="n">Сумма</th><th>Акт</th><th></th></tr>${stRows}</table></div></div>
      <div class="card"><div class="row between"><div class="sec-t" style="margin:0">Услуги в договоре</div>${locked ? `<span class="small muted">договор подписан — изменения только допсоглашением</span>` : `<button class="btn sm" id="editsvc">Изменить</button>`}</div>
        <ol style="margin:10px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${c.services.map((s) => `<li><b>${esc(s.name)}</b> <span class="small muted">· этап ${s.stage || 1}</span><div class="small">${esc(s.description)}</div><div class="small muted">Срок: ${esc(s.term)}. Результат: ${esc(s.result)}</div></li>`).join("")}</ol></div>
      <div class="card flush"><div style="padding:14px 16px 4px" class="row between"><div class="sec-t" style="margin:0">Участники и доли</div>${isOwner() ? `<button class="btn sm" id="saveparts">Сохранить доли</button>` : ""}</div>
        <div class="tw"><table class="t"><tr><th>Функция</th><th>Исполнитель</th><th class="n">Доля</th><th class="n">От суммы</th><th class="n">Начислено</th></tr>${partRows}
        <tr><td colspan="2"><b>Сумма долей</b></td><td class="n"><b style="color:${sumPct === 100 ? "var(--good)" : "var(--bad)"}" id="sump">${sumPct}%</b></td><td colspan="2" class="small muted right">начисление — от фактических оплат</td></tr></table></div></div>
    </div><div class="stack">
      <div class="card"><div class="sec-t">Даты</div><div class="grid2">
        ${field("Подписан", "signed_at", c.signed_at, { type: "date" })}${field("Факт. окончание", "fact_end", c.fact_end, { type: "date" })}
        ${field("Начало услуг", "start_date", c.start_date, { type: "date" })}${field("План. окончание", "plan_end", c.plan_end, { type: "date" })}</div>
        <button class="btn sm" id="savedates" style="margin-top:10px">Сохранить даты</button></div>
      <div class="card"><div class="sec-t">Подписанный экземпляр</div>${c.files && c.files.scan ? `<button class="btn sm" data-dl="${esc(c.files.scan)}" data-name="Договор_${esc(c.number)}_подписан">Скачать скан</button> ` : `<div class="muted small" style="margin-bottom:8px">Не загружен</div>`}<button class="btn sm" id="scan">Загрузить скан</button></div>
      <div class="card"><div class="row between"><div class="sec-t" style="margin:0">Запросы в ВС</div><button class="btn sm" id="req">+ Запрос</button></div>
        ${reqs.length ? `<div class="stack" style="gap:8px;margin-top:10px">${reqs.map((r) => `<div>${pill("vs", r.status)} ${esc(r.summary)}<div class="small muted">${d(r.date)}${r.promised_date ? " · обещали к " + d(r.promised_date) : ""}</div></div>`).join("")}</div>` : `<div class="muted small" style="margin-top:10px">Нет</div>`}</div>
      <div class="card"><div class="sec-t">История</div><div class="timeline">${evs.map((e) => `<div><time>${new Date(e.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><span>${esc(e.text)}${e.user_name ? ` <span class="muted">· ${esc(e.user_name)}</span>` : ""}</span></div>`).join("") || `<span class="muted">Пусто</span>`}</div></div>
      ${c.comment || true ? `<div class="card"><div class="sec-t">Комментарий</div><textarea id="cmt" rows="3">${esc(c.comment)}</textarea><button class="btn sm" id="savecmt" style="margin-top:8px">Сохранить</button></div>` : ""}
    </div></div>`;

  // события
  linkify(main);
  $("#proj", main).onclick = async (e) => { busy(e.target, true, "…"); try { const p = await projectFromContract(c, client); location.hash = `#/projects/${p.id}/schedule`; } catch (err) { toast(err.message, true); busy(e.target, false); } };
  $("#gen", main).onclick = async (e) => { busy(e.target, true, "Собираю…"); try { await generateContractDocs(c, client, true); toast("Файлы договора сформированы"); reload(); } catch (err) { toast(err.message, true); busy(e.target, false); } };
  $$("[data-st]", main).forEach((b) => (b.onclick = async () => {
    const st = b.dataset.st; if (st === c.status) return;
    const patch = { status: st };
    if (st === "signed" && !c.signed_at) patch.signed_at = t;
    if (st === "closed" && !c.fact_end) patch.fact_end = t;
    await updateContract(id, patch, `Статус: ${STATUS.contract[c.status][0]} → ${STATUS.contract[st][0]}`); reload();
  }));
  $$("[data-inv]", main).forEach((b) => (b.onclick = async () => {
    busy(b, true, "…");
    try { const inv = await createInvoice(c, Number(b.dataset.inv)); await generateDoc("Счёт", inv, c, client, "invoices"); toast(`Счёт № ${inv.number} готов`); reload(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }));
  $$("[data-pay]", main).forEach((b) => (b.onclick = () => { const inv = invs.find((i) => i.id === b.dataset.pay); paymentForm(c, invs, inv, reload); }));
  $("#addpay", main).onclick = () => paymentForm(c, invs, null, reload);
  $$("[data-act]", main).forEach((b) => (b.onclick = async () => {
    busy(b, true, "…");
    try { const act = await createAct(c, Number(b.dataset.act)); await generateDoc("Акт", act, c, client, "acts"); toast(`Акт № ${act.number} готов`); reload(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }));
  $$("[data-send]", main).forEach((b) => (b.onclick = () => {
    const act = acts.find((a) => a.id === b.dataset.send);
    modal({ title: `Акт № ${act.number} отправлен`, body: `<div class="grid2">${field("Дата отправки", "sent_at", t, { type: "date" })}${field("Способ", "via", "e-mail", { options: ["e-mail", "ЭДО", "бумага"] })}</div><div class="small muted">Срок приёмки посчитается в рабочих днях: ${c.acceptance_days} раб. дн. с даты отправки.</div>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
      onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async () => { const v = formData(el); await sendAct(act, c, v.sent_at, v.via); close(); reload(); }) });
  }));
  $$("[data-asign]", main).forEach((b) => (b.onclick = async () => {
    const act = acts.find((a) => a.id === b.dataset.asign);
    check(await sb.from("acts").update({ status: "signed" }).eq("id", act.id)); await logEvent(id, `Акт № ${act.number} подписан`);
    if (act.stage === 1 && c.stages.length > 1 && c.status === "work") await updateContract(id, { status: "support" }, "Этап 1 сдан — договор на сопровождении");
    else if (act.stage === c.stages.length && ["work", "support", "delivered"].includes(c.status)) await updateContract(id, { status: "delivered" }, "Все этапы сданы");
    reload();
  }));
  $$("[data-areject]", main).forEach((b) => (b.onclick = async () => { const act = acts.find((a) => a.id === b.dataset.areject); check(await sb.from("acts").update({ status: "rejected" }).eq("id", act.id)); await logEvent(id, `По акту № ${act.number} получен мотивированный отказ`); reload(); }));
  $$("[data-ascan]", main).forEach((b) => (b.onclick = async () => {
    const f = await pickFile(); if (!f) return; const act = acts.find((a) => a.id === b.dataset.ascan);
    const path = `contracts/${id}/scan_act_${act.number}_${Date.now()}.${safePath(f.name.split(".").pop())}`;
    await uploadFile(path, f, f.type); check(await sb.from("acts").update({ files: Object.assign({}, act.files, { scan: path }) }).eq("id", act.id)); await logEvent(id, `Загружен скан акта № ${act.number}`); reload();
  }));
  $("#scan", main).onclick = async () => {
    const f = await pickFile(); if (!f) return;
    const path = `contracts/${id}/scan_contract_${Date.now()}.${safePath(f.name.split(".").pop())}`;
    await uploadFile(path, f, f.type); await updateContract(id, { files: Object.assign({}, c.files, { scan: path }) }, "Загружен скан подписанного договора"); reload();
  };
  $("#savedates", main).onclick = async () => { const v = formData($("#savedates", main).parentElement); for (const k in v) if (!v[k]) v[k] = null; await updateContract(id, v, "Изменены даты договора"); toast("Сохранено"); reload(); };
  const dct = $("#delrec", main); if (dct) dct.onclick = async () => {
    const fs = [...filePaths(c.files), ...invs.flatMap((x) => filePaths(x.files)), ...acts.flatMap((x) => filePaths(x.files))];
    await delRec({ table: "contracts", id, what: `договор № ${c.number}`, warn: `Вместе с ним удалятся счета (${invs.length}), акты (${acts.length}), оплаты (${pays.length}) и их файлы. Проект останется, но без договора.`, files: fs, done: () => (location.hash = "#/contracts/list") });
  };
  $$("[data-paydel]", main).forEach((b) => (b.onclick = async () => {
    const p = pays.find((x) => x.id === b.dataset.paydel);
    await delRec({ table: "payments", id: p.id, what: `оплату ${rub(p.amount)} от ${d(p.date)}`, warn: "Операция в «Финансах» тоже удалится, счёт снова станет неоплаченным.",
      done: async () => { if (p.invoice_id) await sb.from("invoices").update({ status: "issued", paid_at: null }).eq("id", p.invoice_id); await logEvent(id, `Удалена оплата ${rub(p.amount)} от ${d(p.date)}`); reload(); } });
  }));
  $("#savecmt", main).onclick = async () => { await updateContract(id, { comment: $("#cmt", main).value }); toast("Сохранено"); };
  $("#req", main).onclick = () => requestForm({ client_id: c.client_id, contract_id: id }, reload);
  const es = $("#editsvc", main); if (es) es.onclick = () => editServices(c, reload);
  if (isOwner()) {
    $$("[data-pp]", main).forEach((inp) => (inp.onchange = () => { const p = c.participants[Number(inp.dataset.pp)]; p[inp.dataset.k] = inp.dataset.k === "pct" ? Number(inp.value) || 0 : inp.value || null; const s = c.participants.reduce((a, x) => a + Number(x.pct || 0), 0); const el = $("#sump", main); el.textContent = s + "%"; el.style.color = s === 100 ? "var(--good)" : "var(--bad)"; }));
    $("#saveparts", main).onclick = async () => { const s = c.participants.reduce((a, x) => a + Number(x.pct || 0), 0); if (s !== 100) return toast("Сумма долей должна быть 100%", true); await updateContract(id, { participants: c.participants }, "Изменены участники и доли"); toast("Доли сохранены"); reload(); };
  }
}

function paymentForm(c, invs, inv, done) {
  const open = invs.filter((i) => i.status !== "paid" && i.status !== "cancelled");
  modal({
    title: "Поступление оплаты",
    body: `<div class="grid2">${field("Дата поступления", "date", today(), { type: "date" })}${field("Сумма, ₽", "amount", inv ? inv.amount : "", { type: "number", attrs: 'min="0" step="0.01"' })}</div>
      ${field("По счёту", "invoice_id", inv ? inv.id : "", { options: [["", "— без счёта —"], ...open.map((i) => [i.id, `№ ${i.number} на ${rub(i.amount)}`])] })}
      ${field("Комментарий", "comment", "")}
      <div class="small muted">Первая оплата запускает срок: услуги начинаются со следующего рабочего дня.</div>`,
    footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async (e) => {
      const v = formData(el); if (!v.amount) return toast("Укажите сумму", true);
      busy(e.target, true, "…");
      try {
        const upd = await addPayment(c, v);
        if (!c.first_paid_at) { try { const cl = check(await sb.from("clients").select("*").eq("id", c.client_id).single()); await projectFromContract({ ...c, ...upd }, cl); toast("Оплата сохранена, создан проект с графиком работ"); } catch (e2) { toast("Оплата сохранена"); } }
        else toast("Оплата сохранена");
        close(); done();
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    }),
  });
}

function editServices(c, done) {
  const svc = JSON.parse(JSON.stringify(c.services || []));
  const rowsHtml = () => svc.map((s, i) => `<div class="svc-row" data-i="${i}"><span class="muted">${i + 1}.</span><div class="fields"><input data-k="name" value="${esc(s.name)}"><textarea data-k="description" rows="2">${esc(s.description)}</textarea><input data-k="term" value="${esc(s.term)}"><textarea data-k="result" rows="2">${esc(s.result)}</textarea></div>
    <label class="f">Этап<select data-k="stage"><option value="1"${Number(s.stage) !== 2 ? " selected" : ""}>1</option><option value="2"${Number(s.stage) === 2 ? " selected" : ""}>2</option></select></label><label class="f">Цена<input data-k="price" type="number" value="${esc(s.price || "")}"></label><button class="btn ghost danger sm" data-del="${i}">✕</button></div>`).join("");
  modal({
    title: "Услуги договора", wide: true,
    body: `<div id="sv">${rowsHtml()}</div><select id="add"><option value="">+ Добавить услугу из справочника…</option>${S.services.filter((s) => s.active).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>`,
    footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      const bindRows = () => {
        $$(".svc-row", el).forEach((row) => $$("[data-k]", row).forEach((inp) => (inp.oninput = inp.onchange = () => { const s = svc[Number(row.dataset.i)]; s[inp.dataset.k] = ["price", "stage"].includes(inp.dataset.k) ? Number(inp.value) || 0 : inp.value; })));
        $$("[data-del]", el).forEach((b) => (b.onclick = () => { svc.splice(Number(b.dataset.del), 1); $("#sv", el).innerHTML = rowsHtml(); bindRows(); }));
      };
      bindRows();
      $("#add", el).onchange = (e) => { const s = S.services.find((x) => x.id === e.target.value); if (s) { svc.push({ service_id: s.id, name: s.name, description: s.description, term: s.term, result: s.result_criteria, price: Number(s.price) || 0, stage: /^сопровожд/i.test(s.name) ? 2 : 1 }); $("#sv", el).innerHTML = rowsHtml(); bindRows(); } e.target.value = ""; };
      el.querySelector("[data-ok]").onclick = async () => {
        if (svc.some((s) => !s.name || !s.result)) return toast("У каждой услуги должны быть название и результат", true);
        const nc = recalc({ ...c, services: svc });
        await updateContract(c.id, { services: svc, stages: nc.stages }, "Изменён состав услуг"); close(); toast("Сохранено. Пересоберите файлы договора."); done();
      };
    },
  });
}

/* ====================== СЧЕТА И АКТЫ ====================== */
async function docList(main, table, title) {
  const [rows, cs, cls] = await Promise.all([
    sb.from(table).select("*").order("year", { ascending: false }).order("seq", { ascending: false }),
    sb.from("contracts").select("id,number,client_id"), sb.from("clients").select("id,kind,name"),
  ]).then((r) => r.map(check));
  const cm = Object.fromEntries(cs.map((c) => [c.id, c])), cl = Object.fromEntries(cls.map((c) => [c.id, c]));
  const t = today();
  const isInv = table === "invoices";
  main.innerHTML = `<div class="page-head"><h1>${title}</h1><span class="small muted">${isInv ? "Создаются из карточки договора" : "Создаются из приёмки работ в проекте или из карточки договора"}</span></div>
    <div class="filters"><select id="f"><option value="">Все</option>${Object.entries(isInv ? STATUS.invoice : STATUS.act).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select></div><div class="card flush" id="l"></div>`;
  const draw = () => {
    const f = $("#f", main).value;
    const st = (r) => (isInv && r.status === "issued" && r.due_date && r.due_date < t ? "overdue" : r.status);
    const list = rows.filter((r) => !f || st(r) === f);
    $("#l", main).innerHTML = list.length ? `<div class="tw"><table class="t"><tr><th>Номер</th><th>Договор</th><th>Клиент</th><th>${isInv ? "Срок оплаты" : "Срок приёмки"}</th><th>Статус</th><th class="n">Сумма</th><th></th></tr>
      ${list.map((r) => { const c = cm[r.contract_id] || {}; return `<tr><td class="nowrap"><b>№ ${esc(r.number)}</b><div class="small muted">${d(r.date)}</div></td><td><a href="#/contracts/${r.contract_id}">№ ${esc(c.number || "")}</a>${isInv ? ` <span class="small muted">платёж ${r.tranche}</span>` : ` <span class="small muted">этап ${r.stage}</span>`}</td><td>${esc(clientLabel(cl[c.client_id]))}</td><td>${d(isInv ? r.due_date : r.deadline)}</td><td>${pill(isInv ? "invoice" : "act", st(r))}</td><td class="n">${rub(r.amount)}</td><td class="n nowrap">${r.files && r.files.pdf ? `<button class="btn sm" data-dl="${esc(r.files.pdf)}" data-name="${esc(r.files.name)}.pdf">PDF</button> <button class="btn sm" data-dl="${esc(r.files.docx)}" data-name="${esc(r.files.name)}.docx">Word</button>` : ""} ${delBtn("docs", `data-ddel="${r.id}"`)}</td></tr>`; }).join("")}</table></div>`
      : `<div class="empty">Пусто</div>`;
    linkify(main);
    $$("[data-ddel]", main).forEach((b) => (b.onclick = async () => {
      const r = rows.find((x) => x.id === b.dataset.ddel);
      await delRec({ table, id: r.id, what: `${isInv ? "счёт" : "акт"} № ${r.number}`, warn: isInv ? "Оплаты по нему останутся, но без привязки к счёту." : "Работы проекта, вошедшие в акт, снова станут доступны для нового акта.", files: filePaths(r.files),
        done: async () => { await logEvent(r.contract_id, `Удалён ${isInv ? "счёт" : "акт"} № ${r.number}`); docList(main, table, title); } });
    }));
  };
  $("#f", main).onchange = draw; draw();
}
export async function invoices(main) { await docList(main, "invoices", "Счета"); }
export async function acts(main) { await autoAcceptActs(); await docList(main, "acts", "Акты"); }

/* ====================== ВЫПЛАТЫ ====================== */
export async function payouts(main) {
  const [cs, pays, outs, cls] = await Promise.all([
    sb.from("contracts").select("id,number,client_id,participants,total"), sb.from("payments").select("*"),
    sb.from("payouts").select("*").order("date", { ascending: false }), sb.from("clients").select("id,kind,name"),
  ]).then((r) => r.map(check));
  const cl = Object.fromEntries(cls.map((c) => [c.id, c]));
  const all = cs.flatMap((c) => accruals(c, pays).map((a) => ({ ...a, c })));
  const mine = S.profile.person_id;
  const ppl = S.people.filter((p) => can("finance", "watchAll") || p.id === mine);
  const now = new Date();
  let from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to = today();
  const draw = () => {
    const inP = (x) => x.date >= from && x.date <= to;
    $("#pl", main).innerHTML = ppl.map((p) => {
      const acc = all.filter((a) => a.person_id === p.id);
      const accP = acc.filter(inP), outP = outs.filter((o) => o.person_id === p.id && inP(o));
      const totalAcc = acc.reduce((s, a) => s + a.amount, 0), totalOut = outs.filter((o) => o.person_id === p.id).reduce((s, o) => s + Number(o.amount), 0);
      return `<div class="card"><div class="row between"><h2>${esc(p.name)}</h2><span class="st ${totalAcc - totalOut > 0.5 ? "warn" : "good"}">к выплате за всё время: ${rub(totalAcc - totalOut)}</span></div>
        <div class="grid3" style="margin:12px 0"><div><div class="small muted">Начислено за период</div><b>${rub(accP.reduce((s, a) => s + a.amount, 0))}</b></div><div><div class="small muted">Выплачено за период</div><b>${rub(outP.reduce((s, o) => s + Number(o.amount), 0))}</b></div><div><div class="small muted">ИНН</div><b>${esc(p.inn || "ИНН не указан")}</b></div></div>
        ${accP.length ? `<details><summary class="small">Начисления за период (${accP.length})</summary><div class="tw"><table class="t small"><tr><th>Дата оплаты</th><th>Договор</th><th>Функция</th><th class="n">Доля</th><th class="n">Сумма</th></tr>${accP.map((a) => `<tr><td>${d(a.date)}</td><td><a href="#/contracts/${a.contract_id}">№ ${esc(a.c.number)}</a> ${esc(clientLabel(cl[a.c.client_id]))}</td><td>${esc(a.label)}</td><td class="n">${a.pct}%</td><td class="n">${rub(a.amount)}</td></tr>`).join("")}</table></div></details>` : ""}
        <div class="tw" style="margin-top:8px"><table class="t small"><tr><th>Выплата</th><th class="n">Сумма</th><th>Чек</th><th>НПД</th><th>Комментарий</th></tr>
          ${outP.map((o) => `<tr><td>${d(o.date)}</td><td class="n">${rub(o.amount)}</td><td>${o.check_received ? `✓ ${esc(o.check_number)}` : `<span style="color:var(--bad)">нет чека</span>`}</td><td>${o.npd_checked ? "✓ проверен" : "—"}</td><td>${esc(o.comment)} ${can("finance", "edit") ? `<button class="btn sm ghost" data-eo="${o.id}">Изменить</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Выплат за период нет</td></tr>`}</table></div>
        ${can("finance", "edit") ? `<button class="btn sm" data-np="${p.id}" style="margin-top:10px">+ Выплата</button>` : ""}</div>`;
    }).join("") || `<div class="empty">Нет сотрудников</div>`;
    $$("[data-np]", main).forEach((b) => (b.onclick = () => payoutForm({ person_id: b.dataset.np, date: today() }, cs, () => payouts(main))));
    $$("[data-eo]", main).forEach((b) => (b.onclick = () => payoutForm(outs.find((o) => o.id === b.dataset.eo), cs, () => payouts(main))));
  };
  main.innerHTML = `<div class="page-head"><h1>Зарплата</h1><div class="row"><label class="f">С<input type="date" id="pf" value="${from}"></label><label class="f">По<input type="date" id="pt" value="${to}"></label></div></div>
    <div class="note info" style="margin-bottom:14px">Начисления считаются с каждой фактической оплаты клиента по долям из карточки договора. Самозанятому — проверяйте чек и статус НПД: <a href="https://npd.nalog.ru/check-status/" target="_blank" rel="noopener">npd.nalog.ru/check-status</a></div>
    <div class="stack" id="pl"></div>`;
  $("#pf", main).onchange = (e) => { from = e.target.value; draw(); };
  $("#pt", main).onchange = (e) => { to = e.target.value; draw(); };
  draw();
}
function payoutForm(o, cs, done) {
  modal({
    title: o.id ? "Выплата" : "Новая выплата",
    body: `<div class="grid2">${field("Кому", "person_id", o.person_id, { options: S.people.map((p) => [p.id, p.name]) })}${field("Дата", "date", o.date, { type: "date" })}</div>
      <div class="grid2">${field("Сумма, ₽", "amount", o.amount, { type: "number", attrs: 'min="0" step="0.01"' })}${field("По договору (необязательно)", "contract_id", o.contract_id || "", { options: [["", "—"], ...cs.map((c) => [c.id, "№ " + c.number])] })}</div>
      <div class="grid2"><label class="chk"><input type="checkbox" name="check_received"${o.check_received ? " checked" : ""}> Чек получен</label>${field("Номер чека", "check_number", o.check_number)}</div>
      <label class="chk"><input type="checkbox" name="npd_checked"${o.npd_checked ? " checked" : ""}> Статус НПД проверен на npd.nalog.ru</label>
      ${field("Комментарий", "comment", o.comment)}`,
    footer: `${o.id && can("finance", "delete") ? `<button class="btn danger" data-del>Удалить</button>` : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      el.querySelector("[data-ok]").onclick = async () => {
        const v = formData(el); if (!v.amount) return toast("Укажите сумму", true); if (!v.contract_id) v.contract_id = null;
        try { check(o.id ? await sb.from("payouts").update(v).eq("id", o.id) : await sb.from("payouts").insert(v)); close(); done(); } catch (e) { toast(e.message, true); }
      };
      const del = el.querySelector("[data-del]"); if (del) del.onclick = async () => { if (await confirmBox("Удалить выплату?", "Удалить")) { check(await sb.from("payouts").delete().eq("id", o.id)); close(); done(); } };
    },
  });
}

/* ====================== ЗАПРОСЫ В ВС (по модулям программы, как проекты разработки в aroot) ====================== */
export const VS_MODULES = ["Сделки", "Отдел продаж", "Модуль Задачи", "Объекты", "Сметный калькулятор", "Снабжение", "Финансы", "Технадзор", "Замеры", "Документооборот", "Дашборды", "Интеграции", "Обучение Кузьмича", "Мобильное приложение", "Интерфейс и локализация", "Модуль Списки", "Модуль найма", "Оргструктура", "Мотивация", "База знаний", "Риски", "Внутренний мессенджер", "Корпоративные проекты", "Модуль «Комъюнити»", "Юридический блок", "Идеальное демо", "Запросы от ОП"];
const RQ = { mod: "*", f: "open" };
export async function requests(main) {
  const [rows, cls, cs] = await Promise.all([sb.from("vs_requests").select("*").order("date", { ascending: false }), sb.from("clients").select("id,kind,name"), sb.from("contracts").select("id,number,client_id")]).then((r) => r.map(check));
  const cl = Object.fromEntries(cls.map((c) => [c.id, c])), cm = Object.fromEntries(cs.map((c) => [c.id, c]));
  const t = today(), isOpen = (r) => ["sent", "work"].includes(r.status), isLate = (r) => isOpen(r) && r.promised_date && r.promised_date < t;
  const mods = [...VS_MODULES, ...[...new Set(rows.map((r) => r.module).filter((m) => m && !VS_MODULES.includes(m)))]];
  const stat = (m) => { const l = rows.filter((r) => (m === "*" ? true : (r.module || "") === m)); return { all: l.length, open: l.filter(isOpen).length, late: l.filter(isLate).length }; };
  const order = [...mods].sort((a, b) => stat(b).open - stat(a).open || stat(b).all - stat(a).all);
  main.innerHTML = `<div class="page-head"><h1>Запросы в «Включи систему»</h1><button class="btn primary" id="add">+ Запрос</button></div><div id="ml"></div><div><div class="filters"><select id="f"><option value="open">Открытые</option><option value="">Все</option>${Object.entries(STATUS.vs).map(([k, [l]]) => `<option value="${k}"${RQ.f === k ? " selected" : ""}>${l}</option>`).join("")}</select></div><div class="card flush" id="l"></div></div>`;
  $("#f", main).value = RQ.f;
  const draw = () => {
    // плитки модулей, как проекты разработки в aroot: сначала те, где есть запросы
    const item = (m, title) => { const s = stat(m); return `<button data-mod="${esc(m)}" class="fin-acc${RQ.mod === m ? " on" : ""}" style="min-width:0${s.all ? "" : ";opacity:.6"}"><b style="font:600 13.5px var(--body)">${esc(title)}</b><span>${s.late ? `<span style="color:var(--bad)">${s.late} проср. · </span>` : ""}${s.open ? s.open + " откр." : s.all ? "все закрыты" : "запросов нет"}${s.all && s.open !== s.all ? ` · всего ${s.all}` : ""}</span></button>`; };
    const withReq = order.filter((m) => stat(m).all), empty = order.filter((m) => !stat(m).all);
    $("#ml", main).innerHTML = `<div class="rq-mods">${item("*", "Все модули")}${withReq.map((m) => item(m, m)).join("")}${stat("").all ? item("", "Без модуля") : ""}</div>
      ${empty.length ? `<details class="rq-more"${empty.includes(RQ.mod) ? " open" : ""}><summary class="small muted">Модули без запросов (${empty.length})</summary><div class="rq-mods">${empty.map((m) => item(m, m)).join("")}</div></details>` : ""}`;
    const list = rows.filter((r) => (RQ.mod === "*" || (r.module || "") === RQ.mod) && (!RQ.f || (RQ.f === "open" ? isOpen(r) : r.status === RQ.f)));
    const line = (r) => `<tr class="click" data-id="${r.id}"><td class="nowrap">${d(r.date)}</td><td><b>${esc(r.summary)}</b>${r.blocking ? ` <span class="st bad">блокирует</span>` : ""}${r.comment ? `<div class="small muted">${esc(r.comment)}</div>` : ""}</td><td>${esc(r.client_id ? clientLabel(cl[r.client_id]) : "")}${r.contract_id && cm[r.contract_id] ? `<div class="small muted">№ ${esc(cm[r.contract_id].number)}</div>` : ""}</td><td>${r.kind === "bug" ? "ошибка" : "доработка"}</td><td>${esc(r.assigned_to)}</td><td class="nowrap" style="${isLate(r) ? "color:var(--bad)" : ""}">${d(r.promised_date)}</td><td>${pill("vs", r.status)}${r.closed_at ? `<div class="small muted">${d(r.closed_at)}</div>` : ""}</td></tr>`;
    const groups = RQ.mod === "*" ? [...order, ""].map((m) => [m || "Без модуля", list.filter((r) => (r.module || "") === m)]).filter(([, l]) => l.length) : [[null, list]];
    $("#l", main).innerHTML = list.length ? `<div class="tw"><table class="t"><tr><th>Дата</th><th>Суть</th><th>Клиент / договор</th><th>Тип</th><th>Кому</th><th>Обещали</th><th>Статус</th></tr>
      ${groups.map(([g, l]) => `${g ? `<tr class="fin-sec"><td colspan="7">${esc(g)} · ${l.length}</td></tr>` : ""}${l.map(line).join("")}`).join("")}</table></div>` : `<div class="empty" style="border:0">${RQ.mod === "*" ? "Запросов нет" : "По этому модулю запросов нет"}. Нажмите «+ Запрос».</div>`;
    $$("[data-id]", main).forEach((tr) => (tr.onclick = () => requestForm(rows.find((r) => r.id === tr.dataset.id), () => requests(main))));
    $$("[data-mod]", main).forEach((b) => (b.onclick = () => { RQ.mod = b.dataset.mod; draw(); }));
  };
  $("#f", main).onchange = (e) => { RQ.f = e.target.value; draw(); }; draw();
  $("#add", main).onclick = () => requestForm({ module: RQ.mod === "*" ? "" : RQ.mod }, () => requests(main), mods);
}
async function requestForm(r, done, mods = VS_MODULES) {
  const [cls, cs] = await Promise.all([sb.from("clients").select("id,kind,name").order("name"), sb.from("contracts").select("id,number,client_id")]).then((x) => x.map(check));
  if (r.module && !mods.includes(r.module)) mods = [...mods, r.module];
  modal({
    title: r.id ? "Запрос в ВС" : "Новый запрос в ВС",
    body: `${field("Суть запроса", "summary", r.summary, { rows: 2, req: true })}
      <div class="grid3">${field("Модуль программы", "module", r.module || "", { options: [["", "— не указан —"], ...mods.map((m) => [m, m])] })}${field("Клиент", "client_id", r.client_id || "", { options: [["", "—"], ...cls.map((c) => [c.id, clientLabel(c)])] })}${field("Договор", "contract_id", r.contract_id || "", { options: [["", "—"], ...cs.map((c) => [c.id, "№ " + c.number])] })}</div>
      <div class="grid3">${field("Дата", "date", r.date || today(), { type: "date" })}${field("Тип", "kind", r.kind || "bug", { options: [["bug", "ошибка"], ["feature", "доработка"]] })}${field("Статус", "status", r.status || "sent", { options: Object.entries(STATUS.vs).map(([k, [l]]) => [k, l]) })}</div>
      <div class="grid3">${field("Кому передано", "assigned_to", r.assigned_to)}${field("Обещанный срок", "promised_date", r.promised_date, { type: "date" })}${field("Дата закрытия", "closed_at", r.closed_at, { type: "date" })}</div>
      <label class="chk"><input type="checkbox" name="blocking"${r.blocking ? " checked" : ""}> Блокирует проект клиента</label>
      ${field("Комментарий", "comment", r.comment, { rows: 2 })}`,
    footer: `${r.id && can("requests", "delete") ? `<button class="btn danger" data-del>Удалить</button>` : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      el.querySelector("[data-ok]").onclick = async () => {
        const v = formData(el); if (!v.summary) return toast("Опишите суть запроса", true);
        ["client_id", "contract_id", "promised_date", "closed_at"].forEach((k) => { if (!v[k]) v[k] = null; });
        if (["done", "rejected"].includes(v.status) && !v.closed_at) v.closed_at = today();
        try { check(r.id ? await sb.from("vs_requests").update(v).eq("id", r.id) : await sb.from("vs_requests").insert(v)); close(); done(); } catch (e) { toast(e.message, true); }
      };
      const del = el.querySelector("[data-del]"); if (del) del.onclick = async () => { if (await confirmBox("Удалить запрос?", "Удалить")) { check(await sb.from("vs_requests").delete().eq("id", r.id)); close(); done(); } };
    },
  });
}

/* ====================== УСЛУГИ И ПАКЕТЫ ====================== */
export async function catalog(main) {
  return priceList(main, { serviceForm, packageForm });
}
export async function catalogOld(main) {
  await loadRefs();
  const pkName = (id) => (S.packages.find((p) => p.id === id) || {}).name || "";
  main.innerHTML = `<div class="page-head"><h1>Услуги и пакеты</h1><div class="row"><button class="btn" id="addpk">+ Пакет</button><button class="btn primary" id="addsv">+ Услуга</button></div></div>
    <div class="grid4">${S.packages.map((p) => `<div class="card" style="cursor:pointer${p.active ? "" : ";opacity:.55"}" data-pk="${p.id}"><div class="row between"><h3>${esc(p.name)}</h3>${p.active ? "" : `<span class="st">архив</span>`}</div><div class="kpi"><div class="v">${rub(p.price)}</div></div>
      <div class="small muted">${esc(p.term_text || num(p.months_work) + " мес. работ")}${Number(p.months_support) ? ` + ${num(p.months_support)} мес. сопровождения` : ""}</div><div class="small" style="margin-top:6px">${p.schemes.map((s) => SCHEME_LABEL[s]).join(" · ")}</div>
      <div class="small muted" style="margin-top:6px">${S.services.filter((s) => (s.packages || []).includes(p.id) && s.active).length} услуг</div></div>`).join("")}</div>
    <div class="card flush" style="margin-top:14px"><div class="tw"><table class="t"><tr><th>Услуга</th><th>Срок</th><th>Результат</th><th>Пакеты</th><th class="n">Цена</th></tr>
      ${S.services.map((s) => `<tr class="click" data-sv="${s.id}" style="${s.active ? "" : "opacity:.5"}"><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.description)}</div></td><td class="small">${esc(s.term)}</td><td class="small">${esc(s.result_criteria)}</td><td class="small">${(s.packages || []).map(pkName).filter(Boolean).join(", ")}</td><td class="n">${Number(s.price) ? rub(s.price) : "—"}</td></tr>`).join("")}</table></div></div>`;
  $$("[data-pk]", main).forEach((el) => (el.onclick = () => packageForm(S.packages.find((p) => p.id === el.dataset.pk), () => catalog(main))));
  $$("[data-sv]", main).forEach((el) => (el.onclick = () => serviceForm(S.services.find((s) => s.id === el.dataset.sv), () => catalog(main))));
  $("#addpk", main).onclick = () => packageForm({ schemes: ["prepay", "discount", "tranches"], discount_pct: 20, months_work: 1, months_support: 0, active: true, sort: S.packages.length + 1 }, () => catalog(main));
  $("#addsv", main).onclick = () => serviceForm({ active: true, packages: [], sort: S.services.length + 1 }, () => catalog(main));
}
export function serviceForm(s, done) {
  const ro = !isOwner();
  modal({
    title: s.id ? "Услуга" : "Новая услуга", wide: true,
    body: `${field("Название", "name", s.name, { req: true })}${field("Описание — что входит", "description", s.description, { rows: 2 })}
      <div class="grid2">${field("Срок оказания", "term", s.term, { ph: "10 рабочих дней с Даты начала Услуг" })}${field("Цена, ₽ (для индивидуальных договоров)", "price", s.price, { type: "number" })}</div>
      ${field("Критерий результата — что считается выполненным", "result_criteria", s.result_criteria, { rows: 2, req: true })}
      <div class="grid2">${field("Раздел прайса", "category", s.category || "Внедрение программы", { attrs: 'list="catlist"' })}${field("Длительность для графика, рабочих дней", "days", s.days || 5, { type: "number", attrs: 'min="1"' })}</div>
      <datalist id="catlist">${[...new Set(S.services.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <div class="grid2">${field("Нормо-часы", "hours", s.hours, { type: "number" })}${field("Порядок", "sort", s.sort, { type: "number" })}</div>
      <div><div class="sec-t">Входит в пакеты</div><div class="row">${S.packages.map((p) => `<label class="chk"><input type="checkbox" data-pkg="${p.id}"${(s.packages || []).includes(p.id) ? " checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>
      <label class="chk"><input type="checkbox" name="active"${s.active !== false ? " checked" : ""}> Активна (снимите, чтобы убрать в архив)</label>`,
    footer: ro ? `<span class="small muted">Править справочник может владелец</span>` : `${s.id ? delHead("price", "svdel") : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      const ok = el.querySelector("[data-ok]"); if (!ok) return;
      ok.onclick = async () => {
        const v = formData(el); delete v.undefined;
        if (!v.name || !v.result_criteria) return toast("Название и критерий результата обязательны", true);
        v.packages = $$("[data-pkg]", el).filter((x) => x.checked).map((x) => x.dataset.pkg);
        v.price = v.price || 0; v.hours = v.hours || 0; v.sort = v.sort || 0; v.days = v.days || 5;
        try { check(s.id ? await sb.from("services").update(v).eq("id", s.id) : await sb.from("services").insert(v)); close(); toast("Сохранено"); done(); } catch (e) { toast(e.message, true); }
      };
      const dl = el.querySelector("#svdel"); if (dl) dl.onclick = () => delRec({ table: "services", id: s.id, what: `услугу «${s.name}»`, warn: "В уже созданных договорах и КП она останется. Можно вместо этого снять «Активна» — уйдёт в архив.", done: async () => { close(); await loadRefs(); done(); } });
    },
  });
}
export function packageForm(p, done) {
  const ro = !isOwner();
  modal({
    title: p.id ? "Пакет" : "Новый пакет",
    body: `${field("Название", "name", p.name, { req: true })}${field("Суть", "summary", p.summary)}
      <div class="grid3">${field("Цена, ₽", "price", p.price, { type: "number" })}${field("Срок работ, мес.", "months_work", p.months_work, { type: "number", attrs: 'step="0.5"' })}${field("Сопровождение, мес.", "months_support", p.months_support, { type: "number", attrs: 'step="0.5"' })}</div>
      <div class="grid3">${field("Срок текстом (необязательно)", "term_text", p.term_text, { ph: "3 встречи по 2 часа" })}${field("Скидка при оплате сразу, %", "discount_pct", p.discount_pct, { type: "number" })}${field("Порядок", "sort", p.sort, { type: "number" })}</div>
      <div><div class="sec-t">Допустимые схемы оплаты</div><div class="row">${Object.entries(SCHEME_LABEL).map(([k, l]) => `<label class="chk"><input type="checkbox" data-sch="${k}"${(p.schemes || []).includes(k) ? " checked" : ""}> ${l}</label>`).join("")}</div></div>
      <label class="chk"><input type="checkbox" name="active"${p.active !== false ? " checked" : ""}> Активен</label>`,
    footer: ro ? `<span class="small muted">Править пакеты может владелец</span>` : `${p.id ? delHead("price", "pkdel") : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      const ok = el.querySelector("[data-ok]"); if (!ok) return;
      ok.onclick = async () => {
        const v = formData(el); v.schemes = $$("[data-sch]", el).filter((x) => x.checked).map((x) => x.dataset.sch);
        if (!v.name || !v.schemes.length) return toast("Нужны название и хотя бы одна схема оплаты", true);
        ["price", "months_work", "months_support", "discount_pct", "sort"].forEach((k) => (v[k] = v[k] || 0));
        try { check(p.id ? await sb.from("packages").update(v).eq("id", p.id) : await sb.from("packages").insert(v)); close(); toast("Сохранено"); done(); } catch (e) { toast(e.message, true); }
      };
      const dl = el.querySelector("#pkdel"); if (dl) dl.onclick = () => delRec({ table: "packages", id: p.id, what: `пакет «${p.name}»`, fkHint: "По пакету уже есть договоры или КП — снимите галочку «Активен», чтобы скрыть его.", done: async () => { close(); await loadRefs(); done(); } });
    },
  });
}

/* ====================== НАСТРОЙКИ ====================== */
export async function settings(main, tab = "company") {
  await loadRefs();
  const st = S.settings, e = st.executor || {}, o = st.options || {};
  const tpl = (st.templates && st.templates.contract) || CONTRACT_TEMPLATE;
  const hol = st.holidays && Object.keys(st.holidays).length ? st.holidays : DEFAULT_HOLIDAYS;
  const TABS = [["company", "Компания"], ["people", "Люди"], ["roles", "Должности и права"], ["price", "Прайс"], ["finance", "Счета и статьи"], ["templates", "Шаблоны задач"], ["docs", "Договор и календарь"]].filter(([k]) => (k === "price" ? can("price", "see") : k === "finance" ? can("finance", "edit") : can("settings", "see")));
  if (!TABS.some((x) => x[0] === tab)) tab = TABS[0][0];
  const head = `<div class="page-head"><h1>Настройки</h1></div><div class="set-tabs">${TABS.map(([k, l]) => `<a href="#/settings/${k}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</div>`;
  if (tab === "roles") { main.innerHTML = head + `<div id="sb"></div>`; return rolesSettings($("#sb", main)); }
  if (tab === "price") { main.innerHTML = head + `<div id="sb" class="hub-sub"></div>`; return priceList($("#sb", main), { serviceForm, packageForm }); }
  if (tab === "finance") { main.innerHTML = head + `<div id="sb"></div>`; return finSetup($("#sb", main)); }
  if (tab === "templates") { main.innerHTML = head + `<div id="sb"></div>`; return templatesSettings($("#sb", main), main); }
  const company = `<div class="card" id="ex"><div class="sec-t">Реквизиты исполнителя</div>
      <div class="grid2">${field("ФИО", "full_name", e.full_name)}${field("ИНН", "inn", e.inn)}${field("ОГРНИП", "ogrnip", e.ogrnip)}${field("Основание", "basis", e.basis)}</div>
      <div class="grid2">${field("Юридический адрес", "legal_address", e.legal_address)}${field("Почтовый адрес", "postal_address", e.postal_address)}</div>
      <div class="grid4">${field("Расчётный счёт", "account", e.account)}${field("Банк", "bank", e.bank)}${field("БИК", "bik", e.bik)}${field("Корр. счёт", "corr_account", e.corr_account)}</div>
      <div class="grid4">${field("Телефон", "phone", e.phone)}${field("E-mail", "email", e.email)}${field("Сайт", "site", e.site)}${field("Город договоров", "city", e.city)}</div>
      ${field("Суд для споров (в предложном падеже)", "court", e.court)}${field("Налоговый режим — текст для документов", "tax_text", e.tax_text)}
      <button class="btn primary" id="saveex" style="margin-top:10px">Сохранить реквизиты</button></div>
    <div class="card" id="op"><div class="sec-t">Сроки и ключи</div>
      <div class="grid4">${field("Приёмка акта, раб. дней", "acceptance_days", o.acceptance_days || 5, { type: "number" })}${field("Предоплата, раб. дней", "prepay_days", o.prepay_days || 3, { type: "number" })}${field("Срок оплаты счёта, раб. дней", "invoice_due_days", o.invoice_due_days || 3, { type: "number" })}${field("Ключ DaData (API-ключ)", "dadata_key", st.dadata_key, { hint: "для «Заполнить по ИНН»: dadata.ru → Профиль → API-ключ" })}</div>
      <button class="btn primary" id="saveop" style="margin-top:10px">Сохранить</button></div>
    <div class="card" id="sh"><div class="sec-t">Доли по умолчанию для новых договоров</div>
      <div class="tw"><table class="t">${(st.shares || []).map((s, i) => `<tr><td>${esc(s.label)}</td><td style="width:120px"><input type="number" step="0.5" data-sh="${i}" value="${s.pct}"></td></tr>`).join("")}</table></div>
      <button class="btn primary" id="savesh" style="margin-top:10px">Сохранить доли</button></div>`;
  const people = `<div class="card"><div class="sec-t">Люди и доступ</div>
      <div class="tw"><table class="t"><tr><th>Человек</th><th>Должность</th><th>ИНН</th><th>Вход в программу</th></tr>${S.people.map((p) => { const pr = S.profiles.find((x) => x.person_id === p.id), rl = S.roles.find((r) => r.id === p.role_id); return `<tr class="click" data-pp="${p.id}"><td>${esc(p.name)}</td><td>${rl ? esc(rl.name) : `<span class="muted">—</span>`}</td><td>${esc(p.inn)}</td><td>${pr ? `${esc(pr.name)} · ${pr.role === "owner" ? "владелец" : "сотрудник"}` : `<span class="muted">нет</span>`}</td></tr>`; }).join("")}</table></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="addpp">+ Человек</button><span class="small muted">Новый вход в программу создаёт разработчик (Claude) — напишите, кому и на какую почту. Что человек видит — задаёт его должность (вкладка «Должности и права»); владелец видит всё.</span></div></div>`;
  const docs = `<div class="card"><div class="sec-t">Шаблон договора</div>
      <p class="small muted" style="margin-top:0">Разметка: «# » заголовок, «^ » подзаголовок, «= » раздел, «&lt;&gt; слева || справа». Блоки {{intro}}, {{services}}, {{stages}}, {{payment}}, {{requisites}} собираются автоматически. Переменные: {number}, {date_text}, {city}, {total_words}, {tax_text}, {months_work_text}, {support_sentence}, {acceptance_days_text}, {court}. Жирный — **текст**.</p>
      <textarea id="tpl" rows="18" style="font:12.5px/1.45 ui-monospace,Consolas,monospace">${esc(tpl)}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="savetpl">Сохранить шаблон</button><button class="btn" id="resettpl">Вернуть исходный</button><span class="small muted">Версия: ${esc((st.templates && st.templates.version) || CONTRACT_TEMPLATE_VERSION)}</span></div></div>
    <div class="card"><div class="sec-t">Праздники (производственный календарь)</div>
      <p class="small muted" style="margin-top:0">Нерабочие дни, кроме суббот и воскресений, по годам. 2027 год — проверьте, когда выйдет постановление о переносах.</p>
      <textarea id="hol" rows="6" style="font:12.5px ui-monospace,Consolas,monospace">${esc(JSON.stringify(hol, null, 1))}</textarea>
      <button class="btn primary" id="savehol" style="margin-top:10px">Сохранить календарь</button></div>`;
  main.innerHTML = head + (tab === "people" ? people : tab === "docs" ? docs : company);
  const on = (sel, fn) => { const el = $(sel, main); if (el) el.onclick = fn; };
  const save = async (patch, msg = "Сохранено") => { try { check(await sb.from("settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1)); await loadRefs(); toast(msg); } catch (err) { toast(err.message, true); } };
  on("#saveex", () => { const v = formData($("#ex", main)); save({ executor: { ...e, ...v, short_name: "ИП " + v.full_name } }); });
  on("#saveop", () => { const v = formData($("#op", main)); const key = v.dadata_key; delete v.dadata_key; save({ options: { ...o, ...v }, dadata_key: key }); });
  on("#savesh", () => { const sh = (st.shares || []).map((s, i) => ({ ...s, pct: Number($(`[data-sh="${i}"]`, main).value) || 0 })); const sum = sh.reduce((a, s) => a + s.pct, 0); if (sum !== 100) return toast(`Сумма долей ${sum}%, нужно 100%`, true); save({ shares: sh }); });
  on("#savetpl", () => save({ templates: { ...(st.templates || {}), contract: $("#tpl", main).value, version: "custom-" + today() } }, "Шаблон сохранён"));
  on("#resettpl", async () => { if (await confirmBox("Вернуть исходный текст договора? Ваши правки шаблона пропадут.", "Вернуть")) { await save({ templates: {} }, "Возвращён исходный шаблон"); settings(main, "docs"); } });
  on("#savehol", () => { try { const j = JSON.parse($("#hol", main).value); save({ holidays: j }, "Календарь сохранён"); } catch { toast("Ошибка в формате календаря", true); } });
  $$("[data-pp]", main).forEach((tr) => (tr.onclick = () => personForm(S.people.find((p) => p.id === tr.dataset.pp), () => settings(main, "people"))));
  on("#addpp", () => personForm({ status: "selfemployed", active: true }, () => settings(main, "people")));
}
async function personForm(p, done) {
  const pinRow = p.id && isOwner() ? (await sb.from("pins").select("pin").eq("person_id", p.id).maybeSingle()).data : null;
  modal({
    title: p.id ? p.name : "Новый человек",
    body: `${field("ФИО", "name", p.name, { req: true })}${field("Должность", "role_id", p.role_id || "", { options: [["", "— без должности —"], ...S.roles.map((r) => [r.id, r.name])], hint: "Задаёт, что человек видит в программе, и кому уходят задачи из шаблонов" })}${field("ИНН (для выплат самозанятому)", "inn", p.inn)}<label class="chk"><input type="checkbox" name="active"${p.active !== false ? " checked" : ""}> Активен</label><label class="chk" style="margin-top:6px"><input type="checkbox" name="takes_leads"${p.takes_leads ? " checked" : ""}> Получает новые заявки и встречи (в Telegram, «кто первый взял»)</label>${isOwner() && p.id && S.profiles.some((x) => x.person_id === p.id) ? field("Код для входа (4 цифры)", "pin", pinRow ? pinRow.pin : "", { attrs: 'inputmode="numeric" maxlength="4"', hint: "Человек выбирает себя на экране входа и вводит этот код. Пусто — вход только по почте." }) : ""}`,
    footer: `${p.id ? delHead("settings", "ppdel") : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      const dl = el.querySelector("#ppdel"); if (dl) dl.onclick = () => delRec({ table: "people", id: p.id, what: `«${p.name}»`, fkHint: "У человека есть задачи, сделки, доли или выплаты — снимите галочку «Работает», чтобы скрыть его из списков.", done: async () => { close(); await loadRefs(); done(); } });
      el.querySelector("[data-ok]").onclick = async () => {
      const v = formData(el); if (!v.name) return toast("Укажите ФИО", true); v.role_id = v.role_id || null;
      const pin = "pin" in v ? String(v.pin || "").trim() : null; delete v.pin;
      if (pin && !/^\d{4}$/.test(pin)) return toast("Код — ровно 4 цифры", true);
      if (pin !== null && p.id) { const r = pin ? await sb.from("pins").upsert({ person_id: p.id, pin, failed: 0, locked_until: null }) : await sb.from("pins").delete().eq("person_id", p.id); if (r.error) return toast(r.error.message, true); }
      try { check(p.id ? await sb.from("people").update(v).eq("id", p.id) : await sb.from("people").insert(v)); await loadRefs(); close(); done(); } catch (e) { toast(e.message, true); }
    };
    },
  });
}
