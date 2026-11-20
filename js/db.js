// Подключение к базе и общая бизнес-логика.
import { today, nextWorkday, addWorkdays, addMonths, dmyShort, setCalendar } from "./calendar.js?v=15";
import { computeTranches, computeStages } from "./docs.js?v=15";

export const SB_URL = "https://evmqihsukrbasnoyaduv.supabase.co";
export const SB_KEY = "sb_publishable_m0mzaiDkpVLo2rBEeKZhIQ_wDY0FM9W";
export const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, storageKey: "tropos_auth" } });

/** Общее состояние: кто вошёл и справочники. */
export const S = { user: null, profile: null, settings: null, people: [], packages: [], services: [], profiles: [], roles: [], ttpls: [] };
export const isOwner = () => S.profile && S.profile.role === "owner";

export function check({ data, error }) {
  if (error) throw new Error(error.message || "Ошибка базы");
  return data;
}

export async function loadRefs() {
  const [st, ppl, pk, sv, pf, rl, tt] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("people").select("*").order("name"),
    sb.from("packages").select("*").order("sort"),
    sb.from("services").select("*").order("sort"),
    sb.from("profiles").select("*"),
    sb.from("roles").select("*").order("sort"),
    sb.from("task_templates").select("id,name,description,source,stages,sort").order("sort"),
  ]);
  S.roles = rl.error ? [] : rl.data || [];
  S.ttpls = tt.error ? [] : tt.data || [];
  S.settings = check(st) || { executor: {}, templates: {}, shares: [], holidays: {}, options: {} };
  S.people = check(ppl) || [];
  S.packages = check(pk) || [];
  S.services = check(sv) || [];
  S.profiles = check(pf) || [];
  S.profile = S.profiles.find((p) => p.id === S.user.id) || null;
  if (S.settings.holidays && Object.keys(S.settings.holidays).length) setCalendar(S.settings.holidays, S.settings.holidays.__work || null);
}

export const personName = (id) => (S.people.find((p) => p.id === id) || {}).name || "—";

/** Следующий порядковый номер за год в таблице. */
export async function nextSeq(table, year) {
  const r = check(await sb.from(table).select("seq").eq("year", year).order("seq", { ascending: false }).limit(1));
  return (r[0] ? r[0].seq : 0) + 1;
}
export function contractNumber(seq, date) { return `${seq}/${dmyShort(date)}`; }

export async function logEvent(contractId, text) {
  await sb.from("contract_events").insert({ contract_id: contractId, text, user_name: (S.profile && S.profile.name) || "" });
}

/** Пересчёт цены, траншей и этапов договора по его полям. */
export function recalc(c) {
  const services = c.services || [];
  const svcSum = services.reduce((a, s) => a + (Number(s.price) || 0), 0);
  if (!c.package_id && !c.price) c.price = svcSum;
  const price = Number(c.price) || 0;
  c.discount_pct = c.scheme === "discount" ? (Number(c.discount_pct) || 20) : 0;
  c.total = Math.round(price * (1 - c.discount_pct / 100) * 100) / 100;
  c.tranches = computeTranches(c.total, c.scheme);
  c.stages = computeStages(c);
  return c;
}

/** Создать договор (из мастера). */
export async function createContract(c) {
  const year = Number(String(c.date).slice(0, 4));
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq = await nextSeq("contracts", year);
    const row = { ...c, year, seq, number: contractNumber(seq, c.date) };
    const { data, error } = await sb.from("contracts").insert(row).select().single();
    if (!error) { await logEvent(data.id, `Договор № ${data.number} создан`); return data; }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("Не удалось выдать номер договора, попробуйте ещё раз");
}

export async function updateContract(id, patch, eventText) {
  const data = check(await sb.from("contracts").update(patch).eq("id", id).select().single());
  if (eventText) await logEvent(id, eventText);
  return data;
}

/** Счёт на транш. */
export async function createInvoice(c, tranche) {
  const t = (c.tranches || []).find((x) => x.n === tranche) || { n: 1, pct: 100, amount: c.total };
  const date = today();
  const year = Number(date.slice(0, 4));
  const dueDays = (S.settings.options && S.settings.options.invoice_due_days) || 3;
  const multi = (c.tranches || []).length > 1;
  const purpose = `Оплата по договору № ${c.number} от ${dmyFull(c.date)}${multi ? ` (платёж ${t.n}, ${t.pct}%)` : ""}. Без НДС`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq = await nextSeq("invoices", year);
    const { data, error } = await sb.from("invoices").insert({ year, seq, number: String(seq), date, contract_id: c.id, tranche: t.n, amount: t.amount, purpose, due_date: addWorkdays(date, dueDays) }).select().single();
    if (!error) { await logEvent(c.id, `Выставлен счёт № ${data.number} на ${t.amount} ₽`); return data; }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("Не удалось выдать номер счёта");
}
function dmyFull(s) { const [y, m, d] = String(s).slice(0, 10).split("-"); return `${d}.${m}.${y}`; }

/** Акт по этапу. */
export async function createAct(c, stage, o = {}) {
  const st = (c.stages || []).find((x) => x.n === stage) || { n: 1, amount: c.total };
  const date = o.date || today(), year = Number(date.slice(0, 4));
  const services = o.services || (c.services || []).filter((s) => (Number(s.stage) || 1) === stage);
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq = await nextSeq("acts", year);
    const { data, error } = await sb.from("acts").insert({ year, seq, number: String(seq), date, contract_id: c.id, stage, services, amount: o.amount != null ? o.amount : st.amount, ...(o.project_id ? { project_id: o.project_id } : {}) }).select().single();
    if (!error) { await logEvent(c.id, `Создан акт № ${data.number} по этапу ${stage}`); return data; }
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("Не удалось выдать номер акта");
}

/** Отправка акта: дедлайн приёмки в рабочих днях. */
export async function sendAct(act, c, sentAt, via) {
  const deadline = addWorkdays(sentAt, Number(c.acceptance_days) || 5);
  const data = check(await sb.from("acts").update({ sent_at: sentAt, sent_via: via, deadline, status: "sent" }).eq("id", act.id).select().single());
  await logEvent(c.id, `Акт № ${act.number} отправлен (${via}), срок приёмки до ${dmyFull(deadline)}`);
  return data;
}

/** Акты, у которых прошёл срок приёмки без отказа -> «принят по умолчанию». */
export async function autoAcceptActs() {
  const r = await sb.from("acts").update({ status: "accepted_default" }).eq("status", "sent").lt("deadline", today()).select("id,contract_id,number");
  if (r.data) for (const a of r.data) await logEvent(a.contract_id, `Акт № ${a.number} принят по умолчанию: срок приёмки истёк`);
}

/** Платёж: отметка счёта и запуск сроков по первому платежу. */
export async function addPayment(c, { date, amount, invoice_id, comment }) {
  check(await sb.from("payments").insert({ date, amount, contract_id: c.id, invoice_id: invoice_id || null, comment: comment || "" }));
  if (invoice_id) await sb.from("invoices").update({ status: "paid", paid_at: date }).eq("id", invoice_id);
  const patch = {};
  if (!c.first_paid_at || date < c.first_paid_at) {
    patch.first_paid_at = date;
    patch.start_date = nextWorkday(date);
    patch.plan_end = addMonths(patch.start_date, (Number(c.months_work) || 0) + (Number(c.months_support) || 0));
    if (["draft", "sent", "signed"].includes(c.status)) patch.status = "work";
  }
  await logEvent(c.id, `Поступила оплата ${amount} ₽ от ${dmyFull(date)}`);
  if (Object.keys(patch).length) return updateContract(c.id, patch, patch.start_date ? `Дата начала услуг: ${dmyFull(patch.start_date)}` : "");
  return c;
}

/** Начисления по договору: доля каждого участника с каждого платежа. */
export function accruals(contract, payments) {
  const out = [];
  for (const p of payments.filter((x) => x.contract_id === contract.id)) {
    for (const part of contract.participants || []) {
      if (part.fn === "company" || !part.person_id) continue;
      const amount = Math.round(Number(p.amount) * Number(part.pct || 0)) / 100;
      out.push({ person_id: part.person_id, fn: part.fn, label: part.label, pct: part.pct, amount, date: p.date, contract_id: contract.id, payment_id: p.id });
    }
  }
  return out;
}

/** Файлы в хранилище. */
export async function uploadFile(path, blob, contentType) {
  check(await sb.storage.from("docs").upload(path, blob, { upsert: true, contentType }));
  return path;
}
export async function downloadFile(path) {
  const { data, error } = await sb.storage.from("docs").download(path);
  if (error) throw new Error(error.message);
  return data;
}
export const safePath = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "-");

/** DaData: организация/ИП по ИНН. */
export async function dadataParty(inn) {
  const key = S.settings.dadata_key;
  if (!key) throw new Error("Ключ DaData не задан — добавьте его в Настройках");
  const r = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Token " + key },
    body: JSON.stringify({ query: inn }),
  });
  if (!r.ok) throw new Error("DaData ответила ошибкой " + r.status);
  const j = await r.json();
  const s = j.suggestions && j.suggestions[0];
  if (!s) throw new Error("По этому ИНН ничего не найдено");
  const x = s.data;
  const ip = x.type === "INDIVIDUAL";
  const o = {
    kind: ip ? "ИП" : (x.opf && x.opf.short === "ООО" ? "ООО" : (x.opf && x.opf.short) || "ООО"),
    opf: ip ? "" : (x.opf && x.opf.full) || "",
    name: ip ? [x.fio && x.fio.surname, x.fio && x.fio.name, x.fio && x.fio.patronymic].filter(Boolean).join(" ") : (x.name && x.name.full) || s.value,
    inn: x.inn || inn, kpp: x.kpp || "", ogrn: x.ogrn || "",
    legal_address: (x.address && (x.address.unrestricted_value || x.address.value)) || "",
  };
  if (!ip && x.management) { o.signer_name = x.management.name || ""; o.signer_post = cap(x.management.post || ""); }
  if (ip) o.signer_basis = "листа записи ЕГРИП";
  return o;
}
export async function dadataBank(bik) {
  const key = S.settings.dadata_key;
  if (!key) throw new Error("Ключ DaData не задан — добавьте его в Настройках");
  const r = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/bank", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Token " + key },
    body: JSON.stringify({ query: bik }),
  });
  if (!r.ok) throw new Error("DaData ответила ошибкой " + r.status);
  const j = await r.json();
  const s = j.suggestions && j.suggestions[0];
  if (!s) throw new Error("Банк с таким БИК не найден");
  return { bank: (s.data.name && s.data.name.payment) || s.value, corr_account: s.data.correspondent_account || "" };
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
