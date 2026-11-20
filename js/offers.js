// Прайс (выбор услуг кликом) и коммерческие предложения (фирменный PDF + ссылка).
import { sb, S, check, isOwner, loadRefs, uploadFile } from "./db.js?v=15";
import { esc, rub, d, $, $$, toast, modal, field, formData, busy, needPdf } from "./ui.js?v=15";
import { today, addDays, dateText } from "./calendar.js?v=15";
import { moneyWords } from "./words.js?v=15";
import { SCHEME_LABEL } from "./docs.js?v=15";
import { delBtn, delRec } from "./del.js?v=15";

const SEL_KEY = "tr_sel";
export const getSel = () => { try { return JSON.parse(sessionStorage.getItem(SEL_KEY) || "null"); } catch (e) { return null; } };
export const setSel = (v) => { try { v ? sessionStorage.setItem(SEL_KEY, JSON.stringify(v)) : sessionStorage.removeItem(SEL_KEY); } catch (e) {} };
const cats = () => [...new Set(S.services.filter((s) => s.active).map((s) => s.category || "Прочее"))];

/* ====================== ПРАЙС ====================== */
export async function priceList(main, editFns) {
  await loadRefs();
  let sel = getSel() || { package_id: null, ids: [] };
  const draw = () => {
    const chosen = S.services.filter((s) => sel.ids.includes(s.id));
    const pk = S.packages.find((p) => p.id === sel.package_id);
    const total = pk ? Number(pk.price) : chosen.reduce((a, s) => a + Number(s.price || 0), 0);
    const days = chosen.reduce((a, s) => a + Number(s.days || 0), 0);
    main.innerHTML = `<div class="page-head"><h1>Прайс и услуги</h1>${isOwner() ? `<div class="row"><button class="btn" id="addpk">+ Пакет</button><button class="btn" id="addsv">+ Услуга</button></div>` : ""}</div>
      <div class="note info" style="margin-bottom:14px">Здесь настраиваются пакеты и услуги: цена, срок, состав. Изменить — значок ✎. КП и договор теперь делаются из сделки и из раздела «Договоры» — услуги выбираются прямо там. Отсюда тоже можно: нажмите на пакет или услуги и кнопку справа.</div>
      <div class="cols"><div class="stack">
        <div class="card"><div class="sec-t">Пакеты</div><div class="pick">${S.packages.filter((p) => p.active).map((p) => `<button data-pk="${p.id}" aria-pressed="${sel.package_id === p.id}"><div class="row between"><b>${esc(p.name)}</b>${isOwner() ? `<span class="small" data-epk="${p.id}" title="Изменить">✎</span>` : ""}</div><span class="price">${rub(p.price)}</span><span class="small muted">${esc(p.term_text || `${p.months_work} мес. работ`)}${Number(p.months_support) ? ` + ${p.months_support} мес. сопровождения` : ""}</span></button>`).join("")}</div></div>
        ${cats().map((c) => `<div class="card"><div class="sec-t">${esc(c)}</div><div class="stack" style="gap:6px">${S.services.filter((s) => s.active && (s.category || "Прочее") === c).map((s) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">
          <button class="chip" data-sv="${s.id}" aria-pressed="${sel.ids.includes(s.id)}" style="flex:none">${sel.ids.includes(s.id) ? "✓" : "+"}</button>
          <div class="grow" style="min-width:0"><b>${esc(s.name)}</b> <span class="small muted">· ${s.days} р.д.${Number(s.price) ? " · " + rub(s.price) : ""}</span><div class="small muted">${esc(s.description)}</div><div class="small">Результат: ${esc(s.result_criteria)}</div></div>
          ${isOwner() ? `<button class="btn sm ghost" data-esv="${s.id}" title="Изменить">✎</button>` : ""}</div>`).join("")}</div></div>`).join("")}
        ${S.services.some((s) => !s.active) ? `<details class="card"><summary class="small">Архив услуг (${S.services.filter((s) => !s.active).length})</summary>${S.services.filter((s) => !s.active).map((s) => `<div class="row between small" style="padding:4px 0"><span>${esc(s.name)}</span>${isOwner() ? `<button class="btn sm ghost" data-esv="${s.id}">✎</button>` : ""}</div>`).join("")}</details>` : ""}
      </div>
      <div class="card" style="position:sticky;top:16px"><div class="sec-t">Выбрано</div>
        ${pk ? `<div><b>${esc(pk.name)}</b> — ${rub(pk.price)}</div>` : ""}
        ${chosen.length ? `<ol style="margin:8px 0;padding-left:20px">${chosen.map((s) => `<li>${esc(s.name)}</li>`).join("")}</ol>` : `<div class="muted small" style="margin:8px 0">Ничего не выбрано</div>`}
        <div class="row between"><span class="small muted">Услуг: ${chosen.length} · по графику ≈ ${days} р.д.</span><b>${rub(total)}</b></div>
        <div class="stack" style="gap:8px;margin-top:12px"><button class="btn grad" id="mkkp"${chosen.length ? "" : " disabled"}>Сделать КП</button><button class="btn primary" id="mkct"${chosen.length ? "" : " disabled"}>Сделать договор</button><button class="btn ghost" id="clr">Очистить</button></div></div></div>`;
    $$("[data-pk]", main).forEach((b) => (b.onclick = (e) => {
      if (e.target.closest("[data-epk]")) return editFns.packageForm(S.packages.find((p) => p.id === e.target.closest("[data-epk]").dataset.epk), () => priceList(main, editFns));
      const id = b.dataset.pk; if (sel.package_id === id) sel = { package_id: null, ids: [] }; else sel = { package_id: id, ids: S.services.filter((s) => s.active && (s.packages || []).includes(id)).map((s) => s.id) };
      setSel(sel); draw();
    }));
    $$("[data-sv]", main).forEach((b) => (b.onclick = () => { const id = b.dataset.sv; sel.ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id]; setSel(sel); draw(); }));
    $$("[data-esv]", main).forEach((b) => (b.onclick = () => editFns.serviceForm(S.services.find((s) => s.id === b.dataset.esv), () => priceList(main, editFns))));
    $("#clr", main).onclick = () => { sel = { package_id: null, ids: [] }; setSel(null); draw(); };
    $("#mkkp", main).onclick = () => (location.hash = "#/offers/new");
    $("#mkct", main).onclick = () => (location.hash = "#/contracts/new");
    const ap = $("#addpk", main); if (ap) ap.onclick = () => editFns.packageForm({ schemes: ["prepay", "discount", "tranches"], discount_pct: 20, months_work: 1, months_support: 0, active: true, sort: S.packages.length + 1 }, () => priceList(main, editFns));
    const as = $("#addsv", main); if (as) as.onclick = () => editFns.serviceForm({ active: true, packages: [], sort: S.services.length + 1, category: cats()[0], days: 5 }, () => priceList(main, editFns));
  };
  draw();
}

/* ====================== КП: СПИСОК ====================== */
export async function offersPage(main) {
  const rows = check(await sb.from("offers").select("*").order("created_at", { ascending: false }));
  main.innerHTML = `<div class="page-head"><h1>Коммерческие предложения</h1><a class="btn grad" href="#/offers/new">+ Новое КП</a></div>
    <div class="card flush">${rows.length ? `<div class="tw"><table class="t"><tr><th>№</th><th>Клиент</th><th>Пакет / услуги</th><th class="n">Сумма</th><th>Дата</th><th></th></tr>
    ${rows.map((o) => `<tr><td>${o.number}</td><td>${esc(o.client_name)}</td><td class="small">${esc((S.packages.find((p) => p.id === o.package_id) || {}).name || o.services.length + " усл.")}</td><td class="n">${rub(o.price)}</td><td>${d(o.date)}</td><td class="n nowrap">${o.files && o.files.pdf ? `<button class="btn sm" data-open="${esc(o.files.pdf)}">PDF</button> <button class="btn sm" data-link="${esc(o.files.pdf)}">Ссылка клиенту</button>` : ""} ${delBtn("offers", `data-odel="${o.id}"`)}</td></tr>`).join("")}</table></div>` : `<div class="empty" style="border:0">КП пока нет. Нажмите «+ Новое КП» или сделайте его из карточки сделки.</div>`}</div>`;
  $$("[data-open]", main).forEach((b) => (b.onclick = async () => { const { data } = await sb.storage.from("docs").createSignedUrl(b.dataset.open, 3600); if (data) window.open(data.signedUrl, "_blank"); }));
  $$("[data-link]", main).forEach((b) => (b.onclick = () => shareLink(b.dataset.link)));
  $$("[data-odel]", main).forEach((b) => (b.onclick = () => { const o = rows.find((x) => x.id === b.dataset.odel); delRec({ table: "offers", id: o.id, what: `КП № ${o.number} для «${o.client_name}»`, warn: "Ссылка на КП у клиента перестанет открываться.", files: o.files && o.files.pdf ? [o.files.pdf] : [], done: () => offersPage(main) }); }));
}

async function shareLink(path) {
  const { data, error } = await sb.storage.from("docs").createSignedUrl(path, 60 * 60 * 24 * 30);
  if (error) return toast(error.message, true);
  modal({ title: "Ссылка на КП для клиента", body: `<p class="small muted" style="margin:0">Ссылка работает 30 дней. Отправьте её клиенту в Telegram, WhatsApp или на почту.</p><textarea rows="3" readonly id="lnk">${esc(data.signedUrl)}</textarea>`,
    footer: `<button class="btn" data-close>Закрыть</button><button class="btn primary" data-copy>Скопировать</button>`,
    onMount: (el) => (el.querySelector("[data-copy]").onclick = async () => { const t = el.querySelector("#lnk"); try { await navigator.clipboard.writeText(t.value); toast("Ссылка скопирована"); } catch (e) { t.select(); toast("Выделено — нажмите Ctrl+C"); } }) });
}

/* ====================== КП: СОЗДАНИЕ ====================== */
export async function offerNew(main, dealId) {
  await loadRefs();
  const sel = getSel() || { package_id: null, ids: [] };
  const cls = check(await sb.from("clients").select("id,kind,name").order("name"));
  let deal = null; if (dealId) { const r = await sb.from("deals").select("*").eq("id", dealId).single(); deal = r.data; }
  const pkFromDeal = deal && deal.fields.package ? S.packages.find((p) => p.name === deal.fields.package) : null;
  const pk = S.packages.find((p) => p.id === sel.package_id) || pkFromDeal;
  const ids = sel.ids.length ? sel.ids : pk ? S.services.filter((s) => s.active && (s.packages || []).includes(pk.id)).map((s) => s.id) : [];
  let svc = S.services.filter((s) => ids.includes(s.id));
  const price = pk ? Number(pk.price) : svc.reduce((a, s) => a + Number(s.price || 0), 0);
  const clientName = deal ? (deal.fields.company || deal.title) : "";
  main.innerHTML = `<div class="page-head"><div><a href="#/contracts/offers" class="small">← КП</a><h1>Новое КП</h1></div></div>
    <div class="cols"><div class="card stack" id="f">
      <div class="grid2">${field("Кому (компания или имя)", "client_name", clientName, { req: true })}${field("Клиент из базы (необязательно)", "client_id", deal && deal.client_id || "", { options: [["", "—"], ...cls.map((c) => [c.id, (c.kind === "ИП" ? "ИП " : c.kind + " ") + c.name])] })}</div>
      <div class="grid3">${field("Пакет", "package_id", pk ? pk.id : "", { options: [["", "индивидуальный"], ...S.packages.filter((p) => p.active).map((p) => [p.id, p.name])] })}${field("Цена, ₽", "price", price, { type: "number" })}${field("Действует до", "valid", addDays(today(), 14), { type: "date" })}</div>
      ${field("Вступление (необязательно)", "intro", deal && deal.fields.pain ? `Задача: ${deal.fields.pain}` : "", { rows: 3, ph: "Чем поможем именно этому клиенту" })}
      <div id="svcbox"></div>
    </div>
    <div class="card"><div class="sec-t">Что будет в КП</div><ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px"><li>Обложка в фирменном стиле Tropos</li><li>Пакет, цена и сроки</li><li>Состав работ с результатами</li><li>Варианты оплаты: частями 40/30/30 или сразу со скидкой</li><li>Как проходит внедрение — 5 шагов</li><li>Контакты и срок действия</li></ul>
      <button class="btn grad" id="gen" style="margin-top:14px;width:100%">Собрать КП (PDF)</button></div></div>`;
  // услуги выбираются прямо здесь: пакет подставляет свой состав и цену, дальше можно добавить или убрать услуги
  const chosen = new Set(ids);
  const pkSel = $("[name=package_id]", main), priceInp = $("[name=price]", main);
  const drawSvc = () => {
    svc = S.services.filter((s) => chosen.has(s.id));
    $("#svcbox", main).innerHTML = `<div class="sec-t">Услуги в КП (${svc.length})</div>${cats().map((c) => `<div class="small muted" style="margin:8px 0 4px">${esc(c)}</div><div class="chips">${S.services.filter((s) => s.active && (s.category || "Прочее") === c).map((s) => `<button type="button" class="chip" data-sv="${s.id}" aria-pressed="${chosen.has(s.id)}">${chosen.has(s.id) ? "✓ " : ""}${esc(s.name)}</button>`).join("")}</div>`).join("")}`;
    $$("[data-sv]", main).forEach((b) => (b.onclick = () => { const id = b.dataset.sv; chosen.has(id) ? chosen.delete(id) : chosen.add(id); if (!pkSel.value) priceInp.value = S.services.filter((s) => chosen.has(s.id)).reduce((a, s) => a + Number(s.price || 0), 0); drawSvc(); }));
    $("#gen", main).disabled = !svc.length;
  };
  pkSel.onchange = () => { const p = S.packages.find((x) => x.id === pkSel.value); if (p) { chosen.clear(); S.services.filter((s) => s.active && (s.packages || []).includes(p.id)).forEach((s) => chosen.add(s.id)); priceInp.value = Number(p.price); } drawSvc(); };
  drawSvc();
  $("#gen", main).onclick = async (e) => {
    const v = formData($("#f", main)); if (!v.client_name) return toast("Укажите, кому КП", true);
    const p2 = S.packages.find((p) => p.id === v.package_id);
    busy(e.target, true, "Собираю…");
    try {
      const { data: last } = await sb.from("offers").select("number").order("number", { ascending: false }).limit(1);
      const number = ((last && last[0] && last[0].number) || 0) + 1;
      const services = svc.map((s) => ({ service_id: s.id, name: s.name, description: s.description, result: s.result_criteria, days: s.days }));
      const off = check(await sb.from("offers").insert({ number, client_name: v.client_name, client_id: v.client_id || null, deal_id: dealId || null, package_id: p2 ? p2.id : null, services, price: v.price || 0, intro: v.intro }).select().single());
      const blob = await offerPdf(off, p2, v.valid);
      const path = `offers/${off.id}/kp_${number}.pdf`;
      await uploadFile(path, blob, "application/pdf");
      check(await sb.from("offers").update({ files: { pdf: path } }).eq("id", off.id));
      if (dealId) await sb.from("deal_events").insert({ deal_id: dealId, text: `Сформировано КП № ${number} на ${rub(v.price || 0)}`, user_name: S.profile.name });
      window.open(URL.createObjectURL(blob), "_blank");
      toast(`КП № ${number} готово`);
      setSel(null);
      location.hash = "#/contracts/offers";
      setTimeout(() => shareLink(path), 600);
    } catch (err) { toast(err.message, true); busy(e.target, false); }
  };
}

/* ====================== КП: PDF ====================== */
const C = { bg: "#0e0e10", card: "#17171a", line: "#2a2a2e", ink: "#f4f2ec", muted: "#9b988f", orange: "#ff9a1f" };
const GRAD = ["#e8432e", "#f26a22", "#ff9a1f", "#f7c27a", "#f7d9a8", "#9fdcef", "#2ec5f0", "#2a8cf4", "#2357f5"];
function gradBar(x, y, w, h) { const n = GRAD.length, sw = w / n; return GRAD.map((c, i) => ({ type: "rect", x: x + i * sw, y, w: sw + 0.5, h, color: c })); }
function logo() { return { columns: [{ text: "tropos", bold: true, fontSize: 20, color: C.ink, width: "auto" }, { canvas: [...gradBar(0, 6, 34, 14).map((r, i, a) => ({ ...r })), { type: "ellipse", x: 28, y: 13, r1: 5, r2: 5, color: "#fff" }], width: 40, margin: [8, 0, 0, 0] }], columnGap: 0 }; }

export async function offerPdf(o, pk, valid) {
  await needPdf();
  const ex = S.settings.executor || {};
  const price = Number(o.price) || 0;
  const disc = pk ? Number(pk.discount_pct) || 0 : 20;
  const schemes = pk ? pk.schemes : ["prepay", "discount", "tranches"];
  const months = pk ? `${pk.term_text || pk.months_work + " мес. работ"}${Number(pk.months_support) ? " + " + pk.months_support + " мес. сопровождения" : ""}` : `≈ ${o.services.reduce((a, s) => a + Number(s.days || 0), 0)} рабочих дней`;
  const H = (t, sub) => [{ text: sub ? sub.toUpperCase() : "", color: C.orange, fontSize: 8, characterSpacing: 2, margin: [0, 0, 0, 4] }, { text: t.toUpperCase(), bold: true, fontSize: 20, color: C.ink, margin: [0, 0, 0, 14] }];
  const payRows = [];
  if (schemes.includes("tranches")) payRows.push([{ text: "Частями 40 / 30 / 30", bold: true, color: C.ink }, { text: `${rub(price * 0.4)} предоплата · ${rub(price * 0.3)} после работ · ${rub(price * 0.3)} после сопровождения`, color: C.muted }, { text: rub(price), bold: true, color: C.ink, alignment: "right" }]);
  if (schemes.includes("discount") && disc) payRows.push([{ text: `Сразу 100% со скидкой ${disc}%`, bold: true, color: C.orange }, { text: `экономия ${rub(price * disc / 100)}`, color: C.muted }, { text: rub(price * (1 - disc / 100)), bold: true, color: C.orange, alignment: "right" }]);
  if (schemes.includes("prepay") || !payRows.length) payRows.push([{ text: "100% вперёд", bold: true, color: C.ink }, { text: "в течение 3 рабочих дней после подписания договора", color: C.muted }, { text: rub(price), bold: true, color: C.ink, alignment: "right" }]);
  const steps = [["1", "Анализ", "Разбираем, как идут заявки, сметы, закупки и деньги"], ["2", "Настройка", "Программа под ваши процессы, роли и объекты"], ["3", "Обучение", "Каждая роль учится на своих задачах"], ["4", "Запуск", "Команда начинает вести работу в программе"], ["5", "Контроль", "Проверяем, что сотрудники работают в программе, а не в таблицах"]];
  const content = [
    // обложка
    logo(),
    { text: "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ", color: C.orange, fontSize: 9, characterSpacing: 3, margin: [0, 120, 0, 10] },
    { text: pk ? pk.name.toUpperCase() : "ВНЕДРЕНИЕ СИСТЕМЫ УПРАВЛЕНИЯ", bold: true, fontSize: 34, color: C.ink, lineHeight: 1.05 },
    { canvas: gradBar(0, 0, 220, 5), margin: [0, 14, 0, 18] },
    { text: `Для: ${o.client_name}`, fontSize: 14, color: C.ink, margin: [0, 0, 0, 6] },
    { text: `№ ${o.number} от ${dateText(o.date).replace(/[«»]/g, "")} · действует до ${dateText(valid).replace(/[«»]/g, "")}`, fontSize: 10, color: C.muted },
    { text: "Добиваемся не внедрения, а реальной работы сотрудников", fontSize: 13, color: C.ink, margin: [0, 180, 0, 6] },
    { text: "НЕ УХОДИМ, ПОКА КОМАНДА НЕ В ПРОГРАММЕ", fontSize: 8, color: C.muted, characterSpacing: 2, pageBreak: "after" },
    // цена и сроки
    ...H(pk ? pk.name : "Ваш пакет", "Предложение"),
    o.intro ? { text: o.intro, color: C.ink, fontSize: 11, margin: [0, 0, 0, 14] } : { text: "" },
    { table: { widths: ["*", "*"], body: [[{ stack: [{ text: "СТОИМОСТЬ", color: C.muted, fontSize: 8, characterSpacing: 2 }, { text: rub(price), bold: true, fontSize: 26, color: C.orange, margin: [0, 4, 0, 0] }], fillColor: C.card, margin: [12, 12, 12, 12] }, { stack: [{ text: "СРОКИ", color: C.muted, fontSize: 8, characterSpacing: 2 }, { text: months, bold: true, fontSize: 13, color: C.ink, margin: [0, 8, 0, 0] }], fillColor: C.card, margin: [12, 12, 12, 12] }]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 6, vLineColor: () => C.bg }, margin: [0, 0, 0, 22] },
    ...H("Что входит", "Состав работ"),
    ...o.services.map((s, i) => ({ table: { widths: [22, "*"], body: [[{ text: String(i + 1).padStart(2, "0"), color: C.orange, bold: true, fontSize: 10 }, { stack: [{ text: s.name, bold: true, color: C.ink, fontSize: 11 }, s.description ? { text: s.description, color: C.muted, fontSize: 9.5, margin: [0, 2, 0, 0] } : { text: "" }, { text: [{ text: "Результат: ", color: C.orange }, { text: s.result || "", color: C.ink }], fontSize: 9.5, margin: [0, 3, 0, 0] }] }]] }, layout: { hLineWidth: (i) => (i === 1 ? 0.5 : 0), vLineWidth: () => 0, hLineColor: () => C.line, paddingTop: () => 7, paddingBottom: () => 7 }, unbreakable: true })),
    { text: "", pageBreak: "before" },
    ...H("Как проходит внедрение", "Старт — результат"),
    { columns: steps.map(([n, t, s], i) => ({ stack: [{ text: n, bold: true, fontSize: 26, color: GRAD[i * 2] }, { text: t.toUpperCase(), bold: true, color: C.ink, fontSize: 10, margin: [0, 6, 0, 4] }, { text: s, color: C.muted, fontSize: 9 }] })), columnGap: 12, margin: [0, 0, 0, 26] },
    ...H("Оплата", "Частями по ходу работ или сразу со скидкой"),
    { table: { widths: [150, "*", 90], body: payRows }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => C.line, paddingTop: () => 9, paddingBottom: () => 9, fillColor: () => C.card }, margin: [0, 0, 0, 26] },
    ...H("Следующий шаг", "С какого пакета начнём"),
    { columns: [["1", "Вы подтверждаете предложение"], ["2", "Подписываем договор"], ["3", "Назначаем первую встречу"]].map(([n, t], i) => ({ table: { widths: ["*"], body: [[{ text: [{ text: n + "  ", bold: true, fontSize: 18, color: GRAD[i * 3] }, { text: t, color: C.ink, fontSize: 10 }], fillColor: C.card, margin: [10, 10, 10, 10] }]] }, layout: "noBorders" })), columnGap: 8, margin: [0, 0, 0, 22] },
    { canvas: gradBar(0, 0, 515, 2), margin: [0, 0, 0, 10] },
    { columns: [{ text: [{ text: `${ex.short_name || "ИП Акобян Л.З."}\n`, bold: true, color: C.ink }, { text: [ex.phone, ex.email, ex.site].filter(Boolean).join(" · "), color: C.muted }], fontSize: 10 }, { text: `Сумма прописью: ${moneyWords(price)}`, fontSize: 8, color: C.muted, alignment: "right" }] },
  ];
  const dd = {
    pageSize: "A4", pageMargins: [40, 40, 40, 40], content,
    background: () => ({ canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 841.89, color: C.bg }] }),
    defaultStyle: { font: "Roboto", fontSize: 10, color: C.ink, lineHeight: 1.2 },
    footer: (cur, total) => cur > 1 ? { text: `tropos · ${String(cur).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, alignment: "right", fontSize: 8, color: C.muted, margin: [0, 10, 40, 0] } : null,
    info: { title: `КП № ${o.number} — ${o.client_name}` },
  };
  return new Promise((res) => window.pdfMake.createPdf(dd).getBlob(res));
}
