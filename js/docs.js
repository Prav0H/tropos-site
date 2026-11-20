import { needPdf, needDocx } from "./ui.js?v=15";
// Сборка документов: договор, счёт, акт. Одна модель -> PDF (pdfmake) и DOCX (docx).
import { moneyWords, moneyWordsCap, fmtMoney, intWords, plural } from "./words.js?v=15";
import { dateText, dmy } from "./calendar.js?v=15";
import { CONTRACT_TEMPLATE } from "./templates.js?v=15";

/* ---------- стороны ---------- */
export function initials(fio) {
  const p = String(fio || "").trim().split(/\s+/);
  if (!p[0]) return "";
  return p[0] + (p[1] ? " " + p[1][0] + "." : "") + (p[2] ? p[2][0] + "." : "");
}
const isPerson = (c) => (c.kind || "ИП") === "ИП";
const OPF_FULL = { "ООО": "Общество с ограниченной ответственностью" };

export function partyTitle(c) {
  if (isPerson(c)) return `Индивидуальный предприниматель ${c.name}`;
  const opf = c.kind === "ООО" ? OPF_FULL["ООО"] : (c.opf || c.kind || "");
  return `${opf} «${stripQuotes(c.name)}»`;
}
export function partyShort(c) {
  if (isPerson(c)) return `ИП ${c.name}`;
  const abbr = c.kind === "ООО" ? "ООО" : (c.kind || "");
  return `${abbr} «${stripQuotes(c.name)}»`;
}
function stripQuotes(s) { return String(s || "").replace(/^[«"']+|[»"']+$/g, ""); }

/** Сторона договора — нормализованный вид для шаблонов. */
export function partyFromClient(c) {
  const person = isPerson(c);
  return {
    person,
    title: partyTitle(c),
    short: partyShort(c),
    inn: c.inn || "", kpp: c.kpp || "", ogrn: c.ogrn || "",
    ogrnLabel: person ? "ОГРНИП" : "ОГРН",
    signer: person ? c.name : (c.signer_name || ""),
    signerGen: c.signer_name_gen || c.signer_name || "",
    signerPost: person ? "" : (c.signer_post || "Генеральный директор"),
    signerPostGen: c.signer_post_gen || "Генерального директора",
    basis: c.signer_basis || (person ? "листа записи ЕГРИП" : "Устава"),
    legal: c.legal_address || "", postal: c.postal_address || "",
    account: c.account || "", bank: c.bank || "", bik: c.bik || "", corr: c.corr_account || "",
    phone: c.phone || "", email: c.email || "", site: c.site || "", edo: c.edo_id || "",
  };
}
export function partyFromExecutor(e) {
  return partyFromClient({
    kind: e.kind || "ИП", name: e.full_name, inn: e.inn, ogrn: e.ogrnip, signer_basis: e.basis,
    legal_address: e.legal_address, postal_address: e.postal_address, account: e.account, bank: e.bank,
    bik: e.bik, corr_account: e.corr_account, phone: e.phone, email: e.email, site: e.site,
  });
}

function introRuns(p, role, tail) {
  let t;
  if (p.person) {
    t = `${p.title}, ИНН ${p.inn || "________"}, ${p.ogrnLabel} ${p.ogrn || "________"}, действующий на основании ${p.basis}, именуемый в дальнейшем «${role}»`;
  } else {
    t = `${p.title}, ИНН ${p.inn || "________"}${p.kpp ? ", КПП " + p.kpp : ""}, ${p.ogrnLabel} ${p.ogrn || "________"}, в лице ${p.signerPostGen} ${p.signerGen || "________"}, действующего на основании ${p.basis}, именуемое в дальнейшем «${role}»`;
  }
  return [{ text: t, bold: true }, { text: tail }];
}

export function requisiteLines(p) {
  const L = [];
  L.push({ text: p.short, bold: true });
  if (p.inn) L.push({ text: `ИНН: ${p.inn}` + (p.kpp ? ` / КПП: ${p.kpp}` : "") });
  if (p.ogrn) L.push({ text: `${p.ogrnLabel}: ${p.ogrn}` });
  if (p.legal) L.push({ text: `Юридический адрес: ${p.legal}` });
  if (p.postal) L.push({ text: `Почтовый адрес: ${p.postal}` });
  if (p.account) L.push({ text: `Расчётный счёт: ${p.account}` });
  if (p.bank) L.push({ text: `Банк: ${p.bank}` });
  if (p.bik) L.push({ text: `БИК: ${p.bik}` });
  if (p.corr) L.push({ text: `Корр. счёт: ${p.corr}` });
  if (p.phone) L.push({ text: `Тел.: ${p.phone}` });
  if (p.email) L.push({ text: `E-mail: ${p.email}` });
  if (p.site) L.push({ text: `Сайт: ${p.site}` });
  if (p.edo) L.push({ text: `ЭДО: ${p.edo}` });
  return L;
}
function signBlock(p, role) {
  return {
    role, name: p.person ? p.short : `${p.signerPost} ${p.short}`,
    sign: `_________________ / ${initials(p.signer)}`, mp: !p.person,
  };
}

/* ---------- расчёты договора ---------- */
export const SCHEME_LABEL = { prepay: "100% предоплата", discount: "100% со скидкой", tranches: "40 / 30 / 30" };

export function monthsText(m) {
  const n = Number(m) || 0;
  if (Number.isInteger(n)) return `${n} (${intWords(n)}) ${plural(n, ["календарный месяц", "календарных месяца", "календарных месяцев"])}`;
  return `${String(n).replace(".", ",")} календарного месяца`;
}
const GEN = ["", "одного", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти", "десяти", "одиннадцати", "двенадцати", "тринадцати", "четырнадцати", "пятнадцати"];
/** «в течение 1 (одного) календарного месяца» */
export function monthsGenText(m) {
  const n = Number(m) || 0;
  if (Number.isInteger(n) && GEN[n]) return `${n} (${GEN[n]}) ${n === 1 ? "календарного месяца" : "календарных месяцев"}`;
  return `${String(n).replace(".", ",")} календарного месяца`;
}
const lc = (s) => (s && s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s || "");
function daysText(n) {
  const gen = ["", "одного", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти", "десяти", "одиннадцати", "двенадцати", "тринадцати", "четырнадцати", "пятнадцати"];
  const w = gen[n] || intWords(n);
  return `${n} (${w}) ${n === 1 ? "рабочего дня" : "рабочих дней"}`;
}

/** Этапы и их суммы. Этап 2 — сопровождение, если есть услуги этапа 2 или срок сопровождения. */
export function computeStages(c) {
  const svc = c.services || [];
  const has2 = Number(c.months_support) > 0 && svc.some((s) => Number(s.stage) === 2);
  const total = Number(c.total) || 0;
  if (!has2) return [{ n: 1, name: "Внедрение", amount: total }];
  let a1;
  if (c.scheme === "tranches" && (c.tranches || []).length >= 3) {
    const t = c.tranches; a1 = Number(t[0].amount) + Number(t[1].amount);
  } else a1 = Math.round(total * 0.7 * 100) / 100;
  return [{ n: 1, name: "Внедрение", amount: a1 }, { n: 2, name: "Сопровождение", amount: Math.round((total - a1) * 100) / 100 }];
}

export function computeTranches(total, scheme) {
  if (scheme !== "tranches") return [{ n: 1, pct: 100, amount: total, trigger: "sign", due_days: 3 }];
  const a1 = Math.round(total * 0.4 * 100) / 100, a2 = Math.round(total * 0.3 * 100) / 100;
  return [
    { n: 1, pct: 40, amount: a1, trigger: "sign", due_days: 3 },
    { n: 2, pct: 30, amount: a2, trigger: "act1", due_days: 3 },
    { n: 3, pct: 30, amount: Math.round((total - a1 - a2) * 100) / 100, trigger: "act2", due_days: 3 },
  ];
}
export const TRIGGER_LABEL = { sign: "подписание договора", act1: "подписание Акта по Этапу 1", act2: "подписание Акта по Этапу 2" };

/* ---------- договор ---------- */
export function contractModel(c, client, settings) {
  const ex = settings.executor || {};
  const E = partyFromExecutor(ex), C = partyFromClient(client);
  const stages = (c.stages && c.stages.length) ? c.stages : computeStages(c);
  const svc = (c.services || []);
  const prepayDays = (settings.options && settings.options.prepay_days) || 3;
  const vars = {
    number: c.number, date_text: dateText(c.date), city: c.city || ex.city || "",
    total_words: moneyWords(c.total), tax_text: ex.tax_text || "НДС не облагается",
    months_work_text: monthsText(c.months_work),
    support_sentence: Number(c.months_support) > 0 ? ` Срок сопровождения — ${monthsText(c.months_support)} с даты подписания Акта по Этапу 1.` : "",
    acceptance_days_text: daysText(Number(c.acceptance_days) || 5),
    court: ex.court || "Арбитражном суде города Санкт-Петербурга и Ленинградской области",
  };
  const blocks = [];
  const tpl = (settings.templates && settings.templates.contract) || CONTRACT_TEMPLATE;
  const sub = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  for (const raw of tpl.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) blocks.push({ t: "title", text: sub(line.slice(2)) });
    else if (line.startsWith("^ ")) blocks.push({ t: "sub", text: sub(line.slice(2)) });
    else if (line.startsWith("= ")) blocks.push({ t: "h", text: sub(line.slice(2)) });
    else if (line.startsWith("<> ")) { const [l, r] = sub(line.slice(3)).split("||"); blocks.push({ t: "two", left: l.trim(), right: (r || "").trim() }); }
    else if (line.trim() === "{{intro}}") {
      blocks.push({ t: "p", runs: introRuns(E, "Исполнитель", ", с одной стороны, и") });
      blocks.push({ t: "p", runs: introRuns(C, "Заказчик", ", с другой стороны, при совместном упоминании именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем.") });
    } else if (line.trim() === "{{services}}") {
      svc.forEach((s, i) => {
        const last = i === svc.length - 1;
        const runs = [{ text: `2.1.${i + 1}. ` }, { text: s.name, bold: true }];
        if (s.description) runs.push({ text: ` — ${lc(s.description.replace(/[.;]\s*$/, ""))}` });
        runs.push({ text: `. Срок оказания: ${(s.term || "в течение срока оказания Услуг").replace(/[.;]\s*$/, "")}.` });
        runs.push({ text: ` Результат: ${lc((s.result || s.result_criteria || "").replace(/[.;]\s*$/, ""))}${last ? "." : ";"}` });
        blocks.push({ t: "p", runs });
      });
    } else if (line.trim() === "{{stages}}") {
      stages.forEach((st) => {
        const nums = svc.map((s, i) => ({ s, i })).filter(({ s }) => (Number(s.stage) || 1) === st.n).map(({ i }) => `2.1.${i + 1}`);
        const list = nums.length ? (nums.length === 1 ? `пункте ${nums[0]}` : `пунктах ${nums.join(", ")}`) : "пункте 2.1";
        const term = st.n === 1 ? `в течение ${monthsGenText(c.months_work)} с Даты начала Услуг` : `в течение срока сопровождения`;
        blocks.push({ t: "p", runs: [{ text: `2.3.${st.n}. ` }, { text: `Этап ${st.n} «${st.name}»`, bold: true }, { text: ` — Услуги, указанные в ${list} Договора, оказываемые ${term}. Стоимость Этапа — ${moneyWords(st.amount)}.` }] });
      });
    } else if (line.trim() === "{{payment}}") {
      paymentBlocks(c, prepayDays).forEach((b) => blocks.push(b));
    } else if (line.trim() === "{{requisites}}") {
      blocks.push({ t: "req", left: requisiteLines(E), right: requisiteLines(C), signL: signBlock(E, "ИСПОЛНИТЕЛЬ:"), signR: signBlock(C, "ЗАКАЗЧИК:") });
    } else {
      blocks.push({ t: "p", runs: parseRuns(sub(line)) });
    }
  }
  return { blocks, title: `Договор № ${c.number}` };
}

function paymentBlocks(c, prepayDays) {
  const total = Number(c.total) || 0;
  const pd = daysText(prepayDays).replace("рабочих дней", "рабочих дней").replace("рабочего дня", "рабочего дня");
  if (c.scheme === "tranches") {
    const t = (c.tranches && c.tranches.length === 3) ? c.tranches : computeTranches(total, "tranches");
    return [
      { t: "p", runs: [{ text: "4.2. Оплата Услуг производится Заказчиком в три платежа:" }] },
      { t: "p", runs: [{ text: `4.2.1. первый платёж (предоплата) в размере ${t[0].pct} % — ${moneyWords(t[0].amount)} — в срок не позднее ${pd} с даты подписания Договора (Первый платёж);` }] },
      { t: "p", runs: [{ text: `4.2.2. второй платёж в размере ${t[1].pct} % — ${moneyWords(t[1].amount)} — в срок не позднее ${daysText(t[1].due_days || 3)} с даты подписания Акта по Этапу 1 либо с даты, когда Акт считается подписанным в соответствии с пунктом 5.5 Договора;` }] },
      { t: "p", runs: [{ text: `4.2.3. третий платёж в размере ${t[2].pct} % — ${moneyWords(t[2].amount)} — в срок не позднее ${daysText(t[2].due_days || 3)} с даты подписания Акта по Этапу ${(c.stages || []).length > 1 ? 2 : 1} либо с даты, когда Акт считается подписанным в соответствии с пунктом 5.5 Договора.` }] },
    ];
  }
  if (c.scheme === "discount") {
    return [{ t: "p", runs: [{ text: `4.2. Стоимость Услуг, указанная в пункте 4.1 Договора, определена с учётом скидки ${Number(c.discount_pct) || 0} % от базовой стоимости ${moneyWords(c.price)}, предоставленной при условии 100 % (стопроцентной) предварительной оплаты. Оплата производится в срок не позднее ${pd} с даты подписания Договора (Первый платёж). При нарушении указанного срока скидка не применяется, и Заказчик оплачивает Услуги по базовой стоимости.` }] }];
  }
  return [{ t: "p", runs: [{ text: `4.2. Оплата Услуг производится Заказчиком в порядке 100 % (стопроцентной) предварительной оплаты в срок не позднее ${pd} с даты подписания Договора (Первый платёж).` }] }];
}

export function parseRuns(s) {
  const runs = [];
  const re = /\*\*(.+?)\*\*/g; let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}

/* ---------- счёт ---------- */
export function invoiceModel(inv, c, client, settings) {
  const ex = settings.executor || {};
  const E = partyFromExecutor(ex), C = partyFromClient(client);
  const supplier = `${E.short}, ИНН ${E.inn}, ${E.legal}`;
  const buyer = `${C.short}, ИНН ${C.inn}${C.kpp ? ", КПП " + C.kpp : ""}${C.legal ? ", " + C.legal : ""}`;
  const blocks = [
    { t: "table", widths: ["*", 50, 130], rows: [
      [{ text: `${ex.bank || ""}\nБанк получателя`, rowSpan: 2 }, { text: "БИК" }, { text: ex.bik || "" }],
      [{ text: "" }, { text: "Сч. №" }, { text: ex.corr_account || "" }],
      [{ text: `ИНН ${ex.inn || ""}` }, { text: "Сч. №", rowSpan: 2 }, { text: ex.account || "", rowSpan: 2 }],
      [{ text: `${E.short}\nПолучатель` }, { text: "" }, { text: "" }],
    ] },
    { t: "space" },
    { t: "title", text: `Счёт на оплату № ${inv.number} от ${dateText(inv.date).replace(/«|»/g, "")}`, left: true },
    { t: "line" },
    { t: "kv", rows: [["Поставщик (Исполнитель):", supplier], ["Покупатель (Заказчик):", buyer], ["Основание:", `Договор № ${c.number} от ${dmy(c.date)}`]] },
    { t: "space" },
    { t: "table", header: true, widths: [22, "*", 40, 30, 70, 70], rows: [
      ["№", "Товары (работы, услуги)", "Кол-во", "Ед.", "Цена", "Сумма"].map((x) => ({ text: x, bold: true })),
      ["1", inv.purpose, "1", "усл.", fmtMoney(inv.amount), fmtMoney(inv.amount)].map((x) => ({ text: String(x) })),
    ] },
    { t: "totals", rows: [["Итого:", fmtMoney(inv.amount)], ["Без налога (НДС):", "—"], ["Всего к оплате:", fmtMoney(inv.amount)]] },
    { t: "p", runs: [{ text: `Всего наименований 1, на сумму ${fmtMoney(inv.amount)} руб.` }], noIndent: true },
    { t: "p", runs: [{ text: moneyWordsCap(inv.amount), bold: true }], noIndent: true },
    { t: "p", runs: [{ text: `Оплатить не позднее ${dmy(inv.due_date)}. Назначение платежа: ${inv.purpose}` }], noIndent: true },
    { t: "line" },
    { t: "space" },
    { t: "p", runs: [{ text: `Предприниматель  _________________ / ${initials(E.signer)}` }], noIndent: true },
  ];
  return { blocks, title: `Счёт № ${inv.number}` };
}

/* ---------- акт ---------- */
export function actModel(act, c, client, settings) {
  const ex = settings.executor || {};
  const E = partyFromExecutor(ex), C = partyFromClient(client);
  const stages = (c.stages && c.stages.length) ? c.stages : computeStages(c);
  const st = stages.find((s) => s.n === act.stage) || stages[0];
  const svc = act.services && act.services.length ? act.services : (c.services || []).filter((s) => (Number(s.stage) || 1) === act.stage);
  const blocks = [
    { t: "title", text: `АКТ № ${act.number} от ${dateText(act.date).replace(/«|»/g, "")}` },
    { t: "sub", text: "сдачи-приёмки оказанных услуг" },
    { t: "line" },
    { t: "kv", rows: [["Исполнитель:", `${E.short}, ИНН ${E.inn}, ${E.legal}`], ["Заказчик:", `${C.short}, ИНН ${C.inn}${C.legal ? ", " + C.legal : ""}`], ["Основание:", `Договор на оказание услуг по внедрению программы для ЭВМ № ${c.number} от ${dmy(c.date)}`]] },
    { t: "space" },
    { t: "table", header: true, widths: [22, "*", 40, 30, 70, 70], rows: [
      ["№", "Наименование работ, услуг", "Кол-во", "Ед.", "Цена", "Сумма"].map((x) => ({ text: x, bold: true })),
      ["1", `Услуги по внедрению программы для ЭВМ, Этап ${st.n} «${st.name}»`, "1", "усл.", fmtMoney(act.amount), fmtMoney(act.amount)].map((x) => ({ text: String(x) })),
    ] },
    { t: "totals", rows: [["Итого:", fmtMoney(act.amount)], ["Без налога (НДС):", "—"]] },
    { t: "p", runs: [{ text: `Всего оказано услуг 1, на сумму ${fmtMoney(act.amount)} руб.` }], noIndent: true },
    { t: "p", runs: [{ text: moneyWordsCap(act.amount), bold: true }], noIndent: true },
    { t: "space" },
    { t: "p", runs: [{ text: "Перечень оказанных Услуг и достигнутых результатов:", bold: true }], noIndent: true },
    ...svc.map((s, i) => ({ t: "p", runs: [{ text: `${i + 1}. ${s.name}. ` , bold: true }, ...((s.result || s.result_criteria) ? [{ text: `Результат: ${(s.result || s.result_criteria || "").replace(/\.\s*$/, "")}.` }] : [])], noIndent: true })),
    { t: "space" },
    { t: "p", runs: [{ text: `Вышеперечисленные услуги оказаны полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет. В соответствии с пунктом 5.5 Договора, если в течение ${daysText(Number(c.acceptance_days) || 5)} с даты получения настоящего Акта Заказчик не направит мотивированный отказ, Услуги считаются принятыми, а Акт — подписанным.` }], noIndent: true },
    { t: "space" },
    { t: "sign2", signL: signBlock(E, "ИСПОЛНИТЕЛЬ:"), signR: signBlock(C, "ЗАКАЗЧИК:") },
  ];
  return { blocks, title: `Акт № ${act.number}` };
}

/* ---------- имя файла ---------- */
export function fileName(kind, number, client) {
  const opf = (client.kind || "ИП");
  const nm = stripQuotes(client.name).replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_");
  return `${kind}_${opf}_${nm}_№${String(number).replace(/\//g, "-")}`;
}

/* ---------- PDF ---------- */
let fontsReady = null;
async function loadFonts() {
  if (fontsReady) return fontsReady.catch(() => { fontsReady = null; return loadFonts(); });
  fontsReady = (async () => {
    await needPdf();
    const files = { "PTSerif-Regular.ttf": "fonts/PTSerif-Regular.ttf", "PTSerif-Bold.ttf": "fonts/PTSerif-Bold.ttf", "PTSerif-Italic.ttf": "fonts/PTSerif-Italic.ttf", "PTSerif-BoldItalic.ttf": "fonts/PTSerif-BoldItalic.ttf" };
    const vfs = Object.assign({}, window.pdfMake.vfs || {});
    let ok = true;
    for (const [name, url] of Object.entries(files)) {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        let bin = ""; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        vfs[name] = btoa(bin);
      } catch (e) { ok = false; }
    }
    window.pdfMake.vfs = vfs;
    window.pdfMake.fonts = Object.assign({}, window.pdfMake.fonts || {}, ok ? { PTSerif: { normal: "PTSerif-Regular.ttf", bold: "PTSerif-Bold.ttf", italics: "PTSerif-Italic.ttf", bolditalics: "PTSerif-BoldItalic.ttf" } } : {},
      { Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" } });
    return ok ? "PTSerif" : "Roboto";
  })();
  return fontsReady;
}

function pdfRuns(runs) { return runs.map((r) => ({ text: r.text, bold: !!r.bold, italics: !!r.italic })); }
function pdfSign(s) {
  return { stack: [{ text: s.role, bold: true }, { text: s.name, margin: [0, 2, 0, 24] }, { text: s.sign }, s.mp ? { text: "М.П.", margin: [0, 4, 0, 0] } : { text: "" }] };
}
export async function toPdf(model) {
  const font = await loadFonts();
  const content = [];
  for (const b of model.blocks) {
    if (b.t === "title") content.push({ text: b.text, bold: true, fontSize: 14, alignment: b.left ? "left" : "center", margin: [0, 0, 0, 6] });
    else if (b.t === "sub") content.push({ text: b.text, italics: true, alignment: "center", margin: [0, 0, 0, 4] });
    else if (b.t === "h") content.push({ text: b.text, bold: true, fontSize: 12, alignment: "center", margin: [0, 10, 0, 6] });
    else if (b.t === "two") content.push({ columns: [{ text: b.left }, { text: b.right, alignment: "right" }], margin: [0, 8, 0, 10] });
    else if (b.t === "p") content.push({ text: pdfRuns(b.runs), alignment: "justify", leadingIndent: b.noIndent ? 0 : 28, margin: [0, 0, 0, 5] });
    else if (b.t === "space") content.push({ text: " ", margin: [0, 0, 0, 4] });
    else if (b.t === "line") content.push({ canvas: [{ type: "line", x1: 0, y1: 2, x2: 499, y2: 2, lineWidth: 1.2 }], margin: [0, 2, 0, 8] });
    else if (b.t === "kv") content.push({ table: { widths: [130, "*"], body: b.rows.map(([k, v]) => [{ text: k }, { text: v, bold: true }]) }, layout: "noBorders", margin: [0, 0, 0, 4] });
    else if (b.t === "table") content.push({ table: { widths: b.widths, headerRows: b.header ? 1 : 0, body: b.rows.map((r) => r.map((cell) => ({ text: cell.text, bold: !!cell.bold, rowSpan: cell.rowSpan, fontSize: 10 }))) }, margin: [0, 0, 0, 6] });
    else if (b.t === "totals") content.push({ table: { widths: ["*", 90], body: b.rows.map(([k, v]) => [{ text: k, bold: true, alignment: "right" }, { text: v, bold: true, alignment: "right" }]) }, layout: "noBorders", margin: [0, 0, 0, 6] });
    else if (b.t === "req") {
      content.push({ columns: [{ stack: b.left.map((l) => ({ text: l.text, bold: !!l.bold, margin: [0, 0, 0, 2] })) }, { stack: b.right.map((l) => ({ text: l.text, bold: !!l.bold, margin: [0, 0, 0, 2] })) }], columnGap: 24, margin: [0, 8, 0, 14], unbreakable: true });
      content.push({ columns: [pdfSign(b.signL), pdfSign(b.signR)], columnGap: 24, unbreakable: true });
    } else if (b.t === "sign2") content.push({ columns: [pdfSign(b.signL), pdfSign(b.signR)], columnGap: 24, unbreakable: true });
  }
  const dd = {
    pageSize: "A4", pageMargins: [56, 40, 40, 50], content,
    defaultStyle: { font, fontSize: 11, lineHeight: 1.15 },
    footer: (cur, total) => ({ text: `Страница ${cur} из ${total}`, alignment: "center", fontSize: 9, margin: [0, 16, 0, 0] }),
    info: { title: model.title },
  };
  return new Promise((res) => window.pdfMake.createPdf(dd).getBlob(res));
}

/* ---------- DOCX ---------- */
export async function toDocx(model) {
  await needDocx();
  const D = window.docx;
  const { Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = D;
  const F = "Times New Roman";
  const run = (r, size = 24) => new TextRun({ text: r.text, bold: !!r.bold, italics: !!r.italic, font: F, size });
  const P = (opts) => new Paragraph(Object.assign({ spacing: { after: 100, line: 276 } }, opts));
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const cell = (children, w, extra = {}) => new TableCell(Object.assign({ children, width: { size: w, type: WidthType.PERCENTAGE } }, extra));
  const signParas = (s) => [P({ children: [run({ text: s.role, bold: true })] }), P({ children: [run({ text: s.name })], spacing: { after: 480 } }), P({ children: [run({ text: s.sign })] }), ...(s.mp ? [P({ children: [run({ text: "М.П." })] })] : [])];
  const kids = [];
  for (const b of model.blocks) {
    if (b.t === "title") kids.push(P({ alignment: b.left ? AlignmentType.LEFT : AlignmentType.CENTER, children: [run({ text: b.text, bold: true }, 28)] }));
    else if (b.t === "sub") kids.push(P({ alignment: AlignmentType.CENTER, children: [run({ text: b.text, italic: true })] }));
    else if (b.t === "h") kids.push(P({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 }, children: [run({ text: b.text, bold: true })] }));
    else if (b.t === "two") kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [new TableRow({ children: [cell([P({ children: [run({ text: b.left })] })], 50), cell([P({ alignment: AlignmentType.RIGHT, children: [run({ text: b.right })] })], 50)] })] }));
    else if (b.t === "p") kids.push(P({ alignment: AlignmentType.JUSTIFIED, indent: b.noIndent ? undefined : { firstLine: 567 }, children: b.runs.map((r) => run(r)) }));
    else if (b.t === "space") kids.push(P({ children: [] }));
    else if (b.t === "line") kids.push(P({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 1 } }, children: [] }));
    else if (b.t === "kv") kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: b.rows.map(([k, v]) => new TableRow({ children: [cell([P({ children: [run({ text: k }, 22)] })], 28), cell([P({ children: [run({ text: v, bold: true }, 22)] })], 72)] })) }));
    else if (b.t === "table") {
      const tot = b.widths.map((w) => (w === "*" ? 200 : w)).reduce((a, x) => a + x, 0);
      const pct = b.widths.map((w) => Math.round(((w === "*" ? 200 : w) / tot) * 100));
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map((r) => new TableRow({ children: r.map((c, i) => cell([P({ children: [run({ text: c.text, bold: !!c.bold }, 20)] })], pct[i], c.rowSpan ? { rowSpan: c.rowSpan } : {})) })) }));
      kids.push(P({ children: [] }));
    } else if (b.t === "totals") b.rows.forEach(([k, v]) => kids.push(P({ alignment: AlignmentType.RIGHT, children: [run({ text: `${k}  ${v}`, bold: true })] })));
    else if (b.t === "req") {
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [
        new TableRow({ children: [cell(b.left.map((l) => P({ spacing: { after: 40 }, children: [run({ text: l.text, bold: !!l.bold }, 22)] })), 50), cell(b.right.map((l) => P({ spacing: { after: 40 }, children: [run({ text: l.text, bold: !!l.bold }, 22)] })), 50)] }),
        new TableRow({ children: [cell(signParas(b.signL), 50), cell(signParas(b.signR), 50)] }),
      ] }));
    } else if (b.t === "sign2") kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [new TableRow({ children: [cell(signParas(b.signL), 50), cell(signParas(b.signR), 50)] })] }));
  }
  const doc = new D.Document({
    creator: "Tropos", title: model.title,
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1400, right: 850 } } },
      footers: { default: new D.Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Страница ", D.PageNumber.CURRENT, " из ", D.PageNumber.TOTAL_PAGES], font: F, size: 18 })] })] }) },
      children: kids }],
  });
  return D.Packer.toBlob(doc);
}
