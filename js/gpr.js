// Редактор графика работ (ГПР) — функции из прототипа «Тариф ГПР v3»: этапы и работы, полосы мышкой,
// растягивание срока, связи «после / вместе / с середины / на N-й день / свободно», связь на любую строку выше,
// перетаскивание строк, плюсики «+ работа / + этап» на границах строк, «Отвязать все / Связать все», суммы ₽ или %.
// Шкала — рабочие дни от даты начала проекта (выходные и праздники пропускаются).
import { sb, check } from "./db.js?v=15";
import { esc, rub, d, toast, confirmBox } from "./ui.js?v=15";
import { today, nextWorkday, isWorkday } from "./calendar.js?v=15";

const ROW_H = 38, LEFT_W = 560, HEAD_H = 46, PX = { day: 28, week: 9 };
const nid = () => "r" + Math.random().toString(36).slice(2, 9);
const REL0 = () => ({ type: "after", days: 0, day: 1, dep: null });
export const mkW = (title, dur, o = {}) => ({ id: nid(), title, dur, rel: o.rel || REL0(), amount: o.amount || { mode: "none", value: 0 }, done: false });
export const mkS = (title, works, o = {}) => ({ id: nid(), title, dur: o.dur || 5, rel: o.rel || REL0(), amount: o.amount || { mode: "none", value: 0 }, done: false, works });
const REL_TEXT = { after: "после", with: "вместе с", mid: "с середины", lag: "на N-й день", free: "свободно" };
const plural = (n, f) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return f[2]; if (n1 > 1 && n1 < 5) return f[1]; if (n1 === 1) return f[0]; return f[2]; };
const daysText = (n) => `${n} раб. ${plural(n, ["день", "дня", "дней"])}`;
const fmtP = (n) => (Math.round(n * 10) / 10).toLocaleString("ru-RU") + " %";

/* ---------- расчёт ---------- */
export function resolve(t) {
  const res = {}, warn = {};
  let prevStage = null;
  const startFrom = (r, pred, fb) => {
    if (r.type === "free") return Math.max(0, (r.day || 1) - 1);
    if (!pred) return fb;
    if (r.type === "after") return pred.end;
    if (r.type === "with") return pred.start;
    if (r.type === "mid") return pred.start + Math.floor(pred.dur / 2);
    if (r.type === "lag") return pred.start + Math.max(0, r.days || 0);
    return fb;
  };
  t.stages.forEach((s) => {
    let pred = null;
    if (s.rel.dep) { pred = res[s.rel.dep] || null; if (!pred) warn[s.id] = "связь на строку ниже — взята предыдущая"; }
    if (!pred && prevStage) pred = res[prevStage.id];
    const anchor = startFrom(s.rel, pred, 0);
    let prevWork = null, minS = Infinity, maxE = -Infinity;
    s.works.forEach((w, wi) => {
      let p = null;
      if (w.rel.dep) { p = res[w.rel.dep] || null; if (!p) warn[w.id] = "связь на строку ниже — взята предыдущая"; }
      if (!p) p = wi === 0 ? { start: anchor, end: anchor, dur: 0, id: s.id } : res[prevWork.id];
      const start = startFrom(w.rel, p, anchor);
      res[w.id] = { id: w.id, start, dur: w.dur, end: start + w.dur, predId: w.rel.type === "free" ? null : p.id, predBar: { start: p.start, end: p.end, dur: p.dur }, explicit: !!w.rel.dep && !!res[w.rel.dep] };
      minS = Math.min(minS, start); maxE = Math.max(maxE, start + w.dur); prevWork = w;
    });
    const spb = pred ? { start: pred.start, end: pred.end, dur: pred.dur } : null;
    const base = { id: s.id, predId: s.rel.type === "free" || !pred ? null : pred.id, predBar: spb, explicit: !!s.rel.dep && !!res[s.rel.dep] };
    // у этапа свой срок; работы расширяют полосу этапа, только если выходят за неё
    const st0 = s.works.length ? Math.min(anchor, minS) : anchor, en0 = s.works.length ? Math.max(anchor + s.dur, maxE) : anchor + s.dur;
    res[s.id] = { ...base, start: st0, dur: en0 - st0, end: en0, anchor, span: false };
    prevStage = s;
  });
  let total = 0; Object.values(res).forEach((r) => (total = Math.max(total, r.end)));
  return { res, warn, total };
}

/** Даты рабочих дней: dates[i] — i-й рабочий день от начала. */
export function workDates(start, n) {
  let cur = start || nextWorkday(today()); if (!isWorkday(cur)) cur = nextWorkday(cur);
  const out = [cur]; for (let i = 1; i < n; i++) out.push((cur = nextWorkday(cur)));
  return out;
}

export function amountOf(a, total) {
  if (!a || a.mode === "none" || !+a.value) return { rub: 0, pct: 0, has: false };
  if (a.mode === "rub") return { rub: +a.value, pct: total ? (+a.value / total) * 100 : 0, has: true };
  return { rub: total ? (total * +a.value) / 100 : 0, pct: +a.value, has: true };
}
const worksHaveAmounts = (st) => st.works.some((w) => w.amount.mode !== "none" && +w.amount.value);
function stageAmount(st, total) {
  if (st.amount.mode !== "none" && +st.amount.value && !worksHaveAmounts(st)) return { ...amountOf(st.amount, total), own: true };
  let r = 0, p = 0, has = false;
  st.works.forEach((w) => { const a = amountOf(w.amount, total); r += a.rub; p += a.pct; has = has || a.has; });
  return { rub: r, pct: p, has, own: false };
}

/* ---------- редактор ---------- */
let cleanup = null;
/**
 * @param root  контейнер
 * @param opts  { gpr, start, total, onSave(gpr), extraButtons, people:[{id,name}] }
 */
export function gprEditor(root, opts) {
  if (cleanup) cleanup();
  const T = opts.gpr && opts.gpr.stages ? opts.gpr : { stages: [] };
  T.stages.forEach((s) => { s.works = s.works || []; });
  const ui = { scale: T.scale || "day", sel: null };
  const totalSum = Number(opts.total) || 0;
  const people = opts.people || [];
  const short = (n) => { const a = String(n || "").trim().split(/\s+/); return a.length > 1 ? `${a[0]} ${a[1][0]}.` : a[0]; };
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; opts.onSave(JSON.parse(JSON.stringify({ ...T, scale: ui.scale }))); }, 500); };

  const flatRows = () => { const out = []; T.stages.forEach((s, si) => { out.push({ kind: "stage", ref: s, stage: s, si }); s.works.forEach((w, wi) => out.push({ kind: "work", ref: w, stage: s, si, wi })); }); return out; };
  const findRow = (id) => flatRows().find((r) => r.ref.id === id) || null;
  const getRef = (id) => { const r = findRow(id); return r ? r.ref : null; };
  const titleOf = (id) => { const r = findRow(id); return r ? r.ref.title || (r.kind === "stage" ? "Этап" : "Работа") : "?"; };
  const predLabel = (row) => {
    const x = row.ref;
    if (x.rel.dep && getRef(x.rel.dep)) return `«${titleOf(x.rel.dep)}»`;
    if (row.kind === "stage") return row.si > 0 ? "предыдущего этапа" : null;
    return row.wi === 0 ? "начала этапа" : "предыдущей работы";
  };
  const relText = (row) => {
    const x = row.ref, pl = predLabel(row);
    if (x.rel.type === "free") return `свободно: день ${x.rel.day || 1}`;
    if (!pl) return "с 1-го дня";
    if (row.kind === "work" && row.wi === 0 && !x.rel.dep) return x.rel.type === "lag" ? `на ${(x.rel.days || 0) + 1}-й день этапа` : "в начале этапа";
    if (x.rel.type === "lag") return `на ${(x.rel.days || 0) + 1}-й день ${pl}`;
    return `${REL_TEXT[x.rel.type]} ${pl}`;
  };

  root.innerHTML = `<div class="gp-top"><div class="gp-stats" data-stats></div>
      <div class="row" style="gap:6px"><div class="seg" data-scale><button data-s="day">Дни</button><button data-s="week">Недели</button></div>
      <button class="btn sm" data-addstage>+ Этап</button><button class="btn sm" data-unlinkall title="Каждая строка остаётся на своём дне, но больше не двигается за предшественником">⛓ Отвязать все сроки</button><button class="btn sm" data-linkall title="Свободные строки привязываются к предшественнику по текущему положению, полосы не двигаются">🔗 Связать все</button>${opts.extraButtons || ""}</div></div>
    <div class="gp-wrap" data-gw><div class="gp-body" data-gb></div></div>
    <div class="small muted" style="margin-top:6px">Полосу тащите мышкой — сдвиг; правый край — срок; кружок справа — связать с другой строкой; правый клик — привязка и ответственный на весь этап. Строки слева перетаскиваются, «+ работа / + этап» — на границе строк.</div>
    <div class="gp-menu" data-menu hidden></div>`;
  const gw = root.querySelector("[data-gw]"), body = root.querySelector("[data-gb]"), menu = root.querySelector("[data-menu]");

  function render() { renderStats(); renderGrid(); save(); }
  function renderStats() {
    const r = resolve(T), dates = workDates(opts.start, Math.max(1, r.total));
    let sumRub = 0, sumPct = 0, any = false;
    T.stages.forEach((s) => { const a = stageAmount(s, totalSum); sumRub += a.rub; sumPct += a.pct; any = any || a.has; });
    const rows = flatRows(), leaf = rows.filter((x) => x.kind === "work" || !x.ref.works.length), noWho = leaf.filter((x) => !x.ref.who).length;
    let pc = "", pt = "—", ps = "суммы не заданы";
    if (any) { if (!totalSum) { pt = rub(sumRub); ps = "сумма по строкам"; } else if (Math.abs(sumPct - 100) < 0.05) { pc = "ok"; pt = "100 % ✓"; ps = "суммы по этапам сходятся с договором"; } else { pc = "warn"; pt = fmtP(sumPct); ps = sumPct < 100 ? `не хватает ${fmtP(100 - sumPct)}` : `перебор ${fmtP(sumPct - 100)}`; } }
    root.querySelector("[data-stats]").innerHTML = `<div><b>${daysText(r.total)}</b><span>${r.total ? d(dates[0]) + " — " + d(dates[r.total - 1]) : "срок"}</span></div>
      <div><b>${totalSum ? rub(totalSum) : "—"}</b><span>${totalSum ? "сумма проекта" : "сумма не задана"}</span></div>
      <div class="${pc}"><b>${pt}</b><span>${ps}</span></div><div class="${leaf.length && !noWho ? "ok" : noWho ? "warn" : ""}"><b>${leaf.length - noWho} / ${leaf.length}</b><span>${noWho ? "работ с ответственным" : "у всех работ есть ответственный"}</span></div>`;
    root.querySelectorAll("[data-scale] button").forEach((b) => b.classList.toggle("on", b.dataset.s === ui.scale));
  }

  function renderGrid() {
    const sl = gw.scrollLeft, st = gw.scrollTop;
    const { res, warn, total } = resolve(T);
    const pd = PX[ui.scale], days = Math.max(20, Math.ceil((total + 10) / 5) * 5), dates = workDates(opts.start, days);
    body.style.cssText = `--rh:${ROW_H}px;--lw:${LEFT_W}px;--gw:${days * pd}px;--pd:${pd}px`;
    const rows = flatRows();
    // шкала: группы по календарным неделям
    let wk = "", dy = "", g = null;
    const wkKey = (s) => { const x = new Date(s); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toDateString(); };
    dates.forEach((s, i) => { const k = wkKey(s); if (!g || g.k !== k) { if (g) wk += `<div class="wk" style="width:${g.n * pd}px">${g.n * pd >= 34 ? d(g.s).slice(0, 5) : ""}</div>`; g = { k, s, n: 0 }; } g.n++; if (ui.scale === "day") dy += `<div class="dy${s === today() ? " now" : ""}" title="${d(s)}">${+s.slice(8)}</div>`; });
    if (g) wk += `<div class="wk" style="width:${g.n * pd}px">${g.n * pd >= 34 ? d(g.s).slice(0, 5) : ""}</div>`;
    let h = `<div class="gr ghead"><div class="gl"><div class="c title">Этапы и работы</div><div class="c who">Ответственный</div><div class="c amt">Сумма</div><div class="c lnk"></div><div class="c del"></div></div><div class="grt"><div class="weeks">${wk}</div><div class="days">${dy}</div></div></div>`;
    const trange = (r) => (r.dur ? `${d(dates[r.start] || "").slice(0, 5)}–${d(dates[r.end - 1] || "").slice(0, 5)}` : "");
    rows.forEach((row) => {
      const r = res[row.ref.id], x = row.ref, isS = row.kind === "stage";
      let amt;
      if (isS && worksHaveAmounts(x)) { const a = stageAmount(x, totalSum); amt = `<span class="calc-t">Σ ${a.rub ? rub(a.rub) : ""}${totalSum ? " · " + fmtP(a.pct) : ""}</span>`; }
      else if (x.amount.mode === "none") amt = `<button class="lnk-b amt-add" data-amtadd="${x.id}">+ сумма</button>`;
      else {
        const a = x.amount; let calc = "";
        if (a.mode === "rub" && +a.value && totalSum) calc = `= ${fmtP((+a.value / totalSum) * 100)}`;
        if (a.mode === "pct" && +a.value && totalSum) calc = `= ${rub((totalSum * a.value) / 100)}`;
        amt = `<span class="join"><input class="num" data-f="amt" data-id="${x.id}" type="number" min="0" step="${a.mode === "pct" ? 0.5 : 1}" value="${a.value || ""}"><select data-f="amtmode" data-id="${x.id}"><option value="rub"${a.mode === "rub" ? " selected" : ""}>₽</option><option value="pct"${a.mode === "pct" ? " selected" : ""}>%</option><option value="none">убрать</option></select></span><span class="calc">${calc}</span>`;
      }
      const canLink = isS ? row.si > 0 || !!x.rel.dep : true;
      const lnk = canLink ? (x.rel.type === "free" ? `<button class="ic lnk-off" data-lnk="${x.id}" title="Срок свободный (день ${x.rel.day || 1}). Нажмите, чтобы привязать">⛓</button>` : `<button class="ic lnk-on" data-lnk="${x.id}" title="Срок привязан: ${esc(relText(row))}. Нажмите, чтобы отвязать">🔗</button>`) : "";
      const left = r.start * pd, width = Math.max(pd, r.dur * pd);
      const tip = `${isS ? "Этап" : "Работа"}: ${trange(r)}, ${daysText(r.dur)}. Начало: ${relText(row)}${x.done ? ". Выполнено" : ""}`;
      const cls = `bar${isS ? " stagebar" : ""}${x.rel.type === "free" ? " free" : ""}${x.done ? " done" : ""}`;
      const bar = isS && r.span
        ? `<div class="${cls}" data-bar="${x.id}" style="left:${left}px;width:${width}px" title="${esc(tip)}"><span class="lbl">${r.dur} д</span><span class="lk" data-lk="${x.id}"></span></div>`
        : `<div class="${cls}" data-bar="${x.id}" style="left:${left}px;width:${width}px" title="${esc(tip)}"><span class="lbl">${isS ? "" : esc(x.title) + " · "}${r.dur} д</span><span class="rz" data-rz="${x.id}"></span><span class="lk" data-lk="${x.id}"></span></div>`;
      const ins = isS
        ? `<div class="ins">${row.si > 0 ? `<button class="ib" data-insw="${T.stages[row.si - 1].id}:${T.stages[row.si - 1].works.length}">+ работа</button>` : ""}<button class="ib" data-inss="${row.si}">+ этап</button></div>`
        : `<div class="ins"><button class="ib" data-insw="${row.stage.id}:${row.wi}">+ работа</button></div>`;
      h += `<div class="gr ${row.kind}${ui.sel === x.id ? " sel" : ""}${x.done ? " is-done" : ""}" data-row="${x.id}" data-kind="${row.kind}">
        <div class="gl">${ins}<div class="c title"><span class="ttl ${x.title ? "" : "ph"}" data-edit="${x.id}">${esc(x.title) || (isS ? "Название этапа" : "Название работы")}</span>${warn[x.id] ? `<span class="st warn" title="${esc(warn[x.id])}">!</span>` : ""}<span class="dt">${trange(r)}</span></div>
          <div class="c who">${isS && x.works.length ? "" : `<select data-f="who" data-id="${x.id}" class="${x.who ? "" : "none"}" title="Кто отвечает за работу"><option value="">— кто?</option>${people.map((p) => `<option value="${p.id}"${x.who === p.id ? " selected" : ""}>${esc(short(p.name))}</option>`).join("")}</select>`}</div>
          <div class="c amt">${amt}</div><div class="c lnk">${lnk}</div><div class="c del"><button class="ic del-b" data-delrow="${x.id}" title="Удалить">🗑</button></div></div>
        <div class="grt">${bar}</div></div>`;
    });
    if (rows.length) { const ls = T.stages[T.stages.length - 1]; h += `<div class="gr" style="height:14px"><div class="gl" style="border-bottom:0;cursor:default"><div class="ins last"><button class="ib" data-insw="${ls.id}:${ls.works.length}">+ работа</button><button class="ib" data-inss="${T.stages.length}">+ этап</button></div></div><div class="grt" style="border-bottom:0;background-image:none"></div></div>`; }
    const ti = dates.indexOf(today());
    if (ti >= 0) h += `<div class="todayline" style="left:${LEFT_W + ti * pd + pd / 2}px"></div>`;
    h += `<div class="endline" style="left:${LEFT_W + total * pd}px"><span>конец: ${total ? d(dates[total - 1]) : ""}</span></div>`;
    if (!rows.length) h = `<div class="empty" style="margin:20px">Графика пока нет. <button class="btn primary" data-addstage>+ Добавить первый этап</button></div>`;
    body.innerHTML = h;
    if (rows.length) drawConnectors(res, rows, pd);
    gw.scrollLeft = sl; gw.scrollTop = st;
  }

  function drawConnectors(res, rows, pd) {
    const idx = {}; rows.forEach((r, i) => (idx[r.ref.id] = i));
    const y = (id) => HEAD_H + idx[id] * ROW_H + ROW_H / 2;
    let paths = "", caps = "";
    rows.forEach((row) => {
      const r = res[row.ref.id]; if (!r || !r.predId || idx[r.predId] == null || !r.predBar) return;
      const p = r.predBar, type = row.ref.rel.type, c = r.explicit ? "explicit" : "";
      const toX = r.start * pd, toY = y(row.ref.id), fromY = y(r.predId), fromX = type === "after" ? p.end * pd : toX, bh = ROW_H - 16;
      if (type === "after" && Math.abs(toX - fromX) >= 2) {
        paths += toX >= fromX + 4 ? `<path class="${c}" d="M${fromX},${fromY} H${fromX + 6} V${toY} H${toX - 1}"/>` : `<path class="${c}" d="M${fromX},${fromY} H${fromX + 8} V${toY - bh / 2 - 4} H${toX - 8} V${toY} H${toX - 1}"/>`;
        caps += `<circle class="${c}" cx="${fromX}" cy="${fromY}" r="3.5"/><polygon class="${c}" points="${toX},${toY} ${toX - 6},${toY - 4} ${toX - 6},${toY + 4}"/>`;
      } else {
        const sy = fromY + bh / 2 - 2;
        paths += `<path class="${c}" d="M${fromX},${sy} V${toY - bh / 2 - 1}"/>`;
        caps += `<circle class="${c}" cx="${fromX}" cy="${sy}" r="3.5"/><polygon class="${c}" points="${fromX},${toY - bh / 2} ${fromX - 4},${toY - bh / 2 - 6} ${fromX + 4},${toY - bh / 2 - 6}"/>`;
      }
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "conn"); svg.setAttribute("width", body.style.getPropertyValue("--gw")); svg.setAttribute("height", HEAD_H + rows.length * ROW_H);
    svg.innerHTML = paths + caps + '<path class="temp" data-temp d="" style="display:none"/>';
    body.appendChild(svg);
  }

  /* --- правки --- */
  function startEdit(id) {
    const span = body.querySelector(`[data-edit="${id}"]`); if (!span) return;
    const x = getRef(id), inp = document.createElement("input");
    inp.className = "ttl-inp"; inp.value = x.title; inp.maxLength = 255;
    span.replaceWith(inp); inp.focus(); inp.select();
    let fin = false;
    const finish = (ok) => { if (fin) return; fin = true; if (ok) x.title = inp.value.trim(); render(); };
    inp.addEventListener("blur", () => finish(true));
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  }
  function removeRow(id) {
    for (const s of T.stages) { const i = s.works.findIndex((w) => w.id === id); if (i >= 0) return s.works.splice(i, 1)[0]; }
    const i = T.stages.findIndex((s) => s.id === id); if (i >= 0) return T.stages.splice(i, 1)[0];
    return null;
  }
  function moveRow(srcId, tgtId, pos) {
    if (srcId === tgtId) return;
    const src = findRow(srcId), tgt = findRow(tgtId); if (!src || !tgt) return;
    if (src.kind === "stage") {
      if (tgt.stage.id === srcId) return;
      const s = removeRow(srcId); let i = T.stages.findIndex((x) => x.id === tgt.stage.id);
      if (tgt.kind === "work" || pos === "after") i += 1;
      T.stages.splice(i, 0, s);
    } else {
      const w = removeRow(srcId);
      if (tgt.kind === "work") { const st = T.stages.find((s) => s.id === tgt.stage.id); let i = st.works.findIndex((x) => x.id === tgtId); if (pos === "after") i += 1; st.works.splice(i, 0, w); }
      else { const si = T.stages.findIndex((s) => s.id === tgtId); if (pos === "after" || si === 0) T.stages[si].works.splice(0, 0, w); else T.stages[si - 1].works.push(w); }
    }
    render();
  }
  function dropTargetFor(srcId, rowEl, cy) {
    const src = findRow(srcId), tid = rowEl.dataset.row; if (!src || tid === srcId) return null;
    const rc = rowEl.getBoundingClientRect(), after = cy > rc.top + rc.height / 2;
    if (src.kind === "stage" && rowEl.dataset.kind === "work") { const st = findRow(tid).stage; if (st.id === srcId) return null; const last = st.works[st.works.length - 1]; return { id: last ? last.id : st.id, pos: "after" }; }
    if (src.kind === "work" && rowEl.dataset.kind === "stage" && findRow(tid).stage.id === src.stage.id && !after) return null;
    return { id: tid, pos: after ? "after" : "before" };
  }
  function applyStart(x, ns) {
    const r = resolve(T).res[x.id];
    const free = () => { x.rel.type = "free"; x.rel.day = Math.max(1, ns + 1); };
    if (x.rel.type === "free" || !r.predId || !r.predBar) return free();
    const p = r.predBar, off = ns - p.start;
    if (off < 0) { free(); toast("Начало раньше предшественника — срок отвязан"); return; }
    if (p.dur > 0 && off === p.dur) { x.rel.type = "after"; return; }
    if (off === 0) { x.rel.type = p.dur > 0 ? "with" : "after"; return; }
    if (p.dur > 1 && off === Math.floor(p.dur / 2)) { x.rel.type = "mid"; return; }
    x.rel.type = "lag"; x.rel.days = off;
  }
  function linkKeep(x) { const s0 = resolve(T).res[x.id].start; x.rel.type = "after"; if (x.rel.dep && !getRef(x.rel.dep)) x.rel.dep = null; applyStart(x, s0); return x.rel.type !== "free"; }
  function linkRows(srcId, tgtId) {
    if (srcId === tgtId) return;
    const s = findRow(srcId), t = findRow(tgtId); if (!s || !t) return;
    if (s.kind === "stage" && t.kind === "work" && t.stage.id === srcId) return toast("Работа не может зависеть от своего этапа", true);
    if (t.kind === "stage" && s.kind === "work" && s.stage.id === tgtId) return toast("Этап не может зависеть от своей работы", true);
    const rows = flatRows(); if (rows.findIndex((r) => r.ref.id === srcId) > rows.findIndex((r) => r.ref.id === tgtId)) return toast("Связывать можно только со строкой выше. Сначала переставьте строки.", true);
    t.ref.rel.dep = srcId; t.ref.rel.type = "after"; render();
    toast(`«${t.ref.title || "Строка"}» теперь после «${s.ref.title || "строки"}»`);
  }
  function toggleLink(id) {
    const x = getRef(id); if (!x) return;
    if (x.rel.type === "free") { if (linkKeep(x)) toast("Срок привязан: " + relText(findRow(id))); }
    else { x.rel.type = "free"; x.rel.day = resolve(T).res[id].start + 1; toast("Срок отвязан — строка стоит на своём дне"); }
    render();
  }
  function unlinkAll(list) { const { res } = resolve(T); let n = 0; list.forEach((r) => { const x = r.ref; if (x.rel.type === "free") return; x.rel.type = "free"; x.rel.day = res[x.id].start + 1; x.rel.dep = null; n++; }); render(); toast(n ? `Отвязано сроков: ${n}` : "Все сроки уже свободные"); }
  function linkAll(list) { let n = 0, sk = 0; list.forEach((r) => { if (r.ref.rel.type !== "free") return; if (linkKeep(r.ref)) n++; else sk++; }); render(); toast(n ? `Связано строк: ${n}${sk ? `, не связано ${sk} (начинаются раньше предшественника)` : ""}` : sk ? "Эти строки начинаются раньше предшественника — связать нельзя" : "Все строки уже связаны"); }
  async function deleteRow(id) {
    const row = findRow(id); if (!row) return; const x = row.ref, isS = row.kind === "stage";
    if (isS && x.works.length && !(await confirmBox(`Удалить этап «${x.title}» и ${x.works.length} ${plural(x.works.length, ["работу", "работы", "работ"])}? Связи других строк с ними будут сняты.`, "Удалить"))) return;
    removeRow(id);
    flatRows().forEach((rr) => { if (rr.ref.rel.dep === id || (isS && x.works.some((w) => w.id === rr.ref.rel.dep))) rr.ref.rel.dep = null; });
    render(); toast(isS ? "Этап удалён" : "Работа удалена");
  }
  function select(id) { ui.sel = id; body.querySelectorAll(".gr.sel").forEach((r) => r.classList.remove("sel")); const r = body.querySelector(`[data-row="${id}"]`); if (r) r.classList.add("sel"); }
  function addStage() { const s = mkS("Новый этап", []); T.stages.push(s); render(); gw.scrollTop = gw.scrollHeight; startEdit(s.id); }

  function openMenu(id, ev) {
    const row = findRow(id); if (!row) return;
    const x = row.ref, isS = row.kind === "stage", pl = predLabel(row), first = !isS && row.wi === 0 && !x.rel.dep, on = (t) => (x.rel.type === t ? "on" : "");
    const it = [`<div class="ttl">${isS ? "Этап" : "Работа"} · начало: ${esc(relText(row))}</div>`];
    if (isS && x.works.length && people.length) it.push(`<div class="ttl">Ответственный за все работы этапа</div><select data-whoall><option value="">выбрать…</option>${people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><div class="sep"></div>`);
    if (isS && x.works.length) it.push(`<button data-act="unlinkstage">⛓ Отвязать сроки всех работ этапа</button><button data-act="linkstage">🔗 Связать все работы этапа</button><div class="sep"></div>`);
    if (pl && !first) it.push(`<button class="${on("after")}" data-act="after">→ После ${esc(pl)}</button><button class="${on("with")}" data-act="with">∥ Вместе с ${esc(pl)}</button><button class="${on("mid")}" data-act="mid">½ С середины ${esc(pl)}</button>`);
    else if (first) it.push(`<button class="${x.rel.type !== "free" ? "on" : ""}" data-act="after">→ В начале этапа</button>`);
    if (x.rel.type !== "free" && pl) it.push(`<button data-act="unlink">⛓ Отвязать срок (оставить на своём дне)</button>`);
    if (x.rel.type === "free" && pl) it.push(`<button data-act="relink">🔗 Привязать срок к предыдущей (полоса не двигается)</button>`);
    if (x.rel.dep) it.push(`<button data-act="undep">↺ Связать с предыдущей строкой вместо «${esc(titleOf(x.rel.dep)).slice(0, 24)}»</button>`);
    menu.innerHTML = it.join(""); menu.hidden = false;
    menu.style.left = Math.min(ev.clientX, window.innerWidth - 320) + "px"; menu.style.top = Math.min(ev.clientY, window.innerHeight - menu.offsetHeight - 10) + "px";
    const wa = menu.querySelector("[data-whoall]"); if (wa) wa.onchange = () => { if (!wa.value) return; x.works.forEach((w) => (w.who = wa.value)); menu.hidden = true; render(); toast("Ответственный назначен на все работы этапа"); };
    menu.onclick = (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return; menu.hidden = true;
      const a = b.dataset.act;
      if (a === "unlinkstage") return unlinkAll(flatRows().filter((r) => r.kind === "work" && r.stage.id === x.id));
      if (a === "linkstage") return linkAll(flatRows().filter((r) => r.kind === "work" && r.stage.id === x.id));
      if (a === "after" || a === "with" || a === "mid") x.rel.type = a;
      if (a === "unlink") { x.rel.type = "free"; x.rel.day = resolve(T).res[id].start + 1; }
      if (a === "relink") linkKeep(x);
      if (a === "undep") { x.rel.dep = null; x.rel.type = "after"; }
      render();
    };
  }

  /* --- мышь --- */
  let ds = null;
  const tipEl = () => { let t = body.querySelector(".gp-tip"); if (!t) { t = document.createElement("div"); t.className = "gp-tip"; body.appendChild(t); } return t; };
  const showTip = (e, txt) => { const t = tipEl(), br = body.getBoundingClientRect(); t.textContent = txt; t.style.left = e.clientX - br.left + "px"; t.style.top = e.clientY - br.top + "px"; };
  const hideTip = () => { const t = body.querySelector(".gp-tip"); if (t) t.remove(); };
  const dateAt = (i) => { const ds2 = workDates(opts.start, i + 1); return d(ds2[i]); };
  body.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const pd = PX[ui.scale];
    const lk = e.target.closest("[data-lk]");
    if (lk) { e.preventDefault(); const bar = lk.closest(".bar"); ds = { kind: "link", id: lk.dataset.lk, fromX: bar.offsetLeft + bar.offsetWidth + 6, fromY: bar.closest(".gr").offsetTop + ROW_H / 2, target: null }; gw.classList.add("linking"); return; }
    const rz = e.target.closest("[data-rz]");
    if (rz) { e.preventDefault(); const x = getRef(rz.dataset.rz), bar = rz.closest(".bar"); ds = { kind: "resize", x, bar, x0: e.clientX, dur0: resolve(T).res[x.id].dur, pd }; bar.classList.add("moving"); return; }
    const bar = e.target.closest("[data-bar]");
    if (bar) { e.preventDefault(); const x = getRef(bar.dataset.bar); ds = { kind: "move", x, bar, x0: e.clientX, l0: bar.offsetLeft, start0: resolve(T).res[x.id].start, pd, moved: false }; bar.classList.add("moving"); select(x.id); return; }
    const row = e.target.closest("[data-row]");
    if (e.target.closest(".gl") && row && !e.target.closest("input,select,button,.ins")) ds = { kind: "row", id: row.dataset.row, rowEl: row, x0: e.clientX, y0: e.clientY, started: false, target: null, edit: e.target.closest("[data-edit]") };
  });
  const onMove = (e) => {
    if (!ds) return;
    if (ds.kind === "move") { const dd = Math.round((e.clientX - ds.x0) / ds.pd); if (dd) ds.moved = true; ds.bar.style.left = Math.max(0, ds.l0 + dd * ds.pd) + "px"; showTip(e, `с ${dateAt(Math.max(0, ds.start0 + dd))}`); }
    else if (ds.kind === "resize") { const dur = Math.max(1, ds.dur0 + Math.round((e.clientX - ds.x0) / ds.pd)); ds.bar.style.width = dur * ds.pd + "px"; showTip(e, daysText(dur)); }
    else if (ds.kind === "link") {
      const br = body.getBoundingClientRect(), tmp = body.querySelector("[data-temp]");
      if (tmp) { tmp.style.display = ""; tmp.setAttribute("d", `M${ds.fromX},${ds.fromY} L${e.clientX - br.left - LEFT_W},${e.clientY - br.top}`); }
      body.querySelectorAll(".bar.drag-target").forEach((b) => b.classList.remove("drag-target"));
      const el = document.elementFromPoint(e.clientX, e.clientY), row = el && el.closest("[data-row]");
      ds.target = row && row.dataset.row !== ds.id ? row.dataset.row : null;
      if (ds.target) { const b = row.querySelector(".bar"); if (b) b.classList.add("drag-target"); }
    } else if (ds.kind === "row") {
      if (!ds.started) { if (Math.abs(e.clientX - ds.x0) + Math.abs(e.clientY - ds.y0) < 5) return; ds.started = true; ds.rowEl.classList.add("dragging"); document.body.classList.add("rowdrag"); }
      body.querySelectorAll(".drop-before,.drop-after").forEach((r) => r.classList.remove("drop-before", "drop-after"));
      const el = document.elementFromPoint(e.clientX, e.clientY), row = el && el.closest ? el.closest("[data-row]") : null;
      ds.target = row ? dropTargetFor(ds.id, row, e.clientY) : null;
      if (ds.target) { const t = body.querySelector(`[data-row="${ds.target.id}"]`); if (t) t.classList.add(ds.target.pos === "after" ? "drop-after" : "drop-before"); }
    }
  };
  const onUp = (e) => {
    if (!ds) return;
    const x = ds; ds = null; hideTip(); gw.classList.remove("linking"); document.body.classList.remove("rowdrag");
    if (x.kind === "move") { x.bar.classList.remove("moving"); const dd = Math.round((e.clientX - x.x0) / x.pd); if (!x.moved || !dd) return renderGrid(); applyStart(x.x, Math.max(0, x.start0 + dd)); render(); }
    else if (x.kind === "resize") { x.bar.classList.remove("moving"); const nd = Math.max(1, x.dur0 + Math.round((e.clientX - x.x0) / x.pd)); const r = resolve(T).res[x.x.id]; x.x.dur = r && r.anchor != null ? Math.max(1, nd - (r.anchor - r.start)) : nd; render(); }
    else if (x.kind === "link") { if (x.target) linkRows(x.id, x.target); else renderGrid(); }
    else if (x.kind === "row") {
      body.querySelectorAll(".drop-before,.drop-after,.dragging").forEach((r) => r.classList.remove("drop-before", "drop-after", "dragging"));
      if (x.started) { if (x.target) moveRow(x.id, x.target.id, x.target.pos); } else { select(x.id); if (x.edit) startEdit(x.id); }
    }
  };
  const onDocClick = (e) => { if (!menu.hidden && !e.target.closest("[data-menu]")) menu.hidden = true; };
  const onKey = (e) => { if (e.key === "Escape") menu.hidden = true; };
  document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey);
  cleanup = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); };

  body.addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-bar]") || e.target.closest("[data-row]"); if (!b) return; e.preventDefault(); openMenu(b.dataset.bar || b.dataset.row, e); });
  body.addEventListener("change", (e) => {
    const el = e.target.closest("[data-f]"); if (!el) return; const x = getRef(el.dataset.id); if (!x) return;
    if (el.dataset.f === "who") x.who = el.value || null;
    if (el.dataset.f === "amt") x.amount.value = Math.max(0, +el.value || 0);
    if (el.dataset.f === "amtmode") { x.amount.mode = el.value; if (el.value === "none") x.amount.value = 0; }
    render();
  });
  root.addEventListener("click", (e) => {
    const t = e.target;
    const sc = t.closest("[data-s]"); if (sc) { ui.scale = sc.dataset.s; renderStats(); renderGrid(); save(); return; }
    if (t.closest("[data-addstage]")) return addStage();
    if (t.closest("[data-unlinkall]")) return unlinkAll(flatRows());
    if (t.closest("[data-linkall]")) return linkAll(flatRows());
    const db = t.closest("[data-delrow]"); if (db) return deleteRow(db.dataset.delrow);
    const aa = t.closest("[data-amtadd]"); if (aa) { const x = getRef(aa.dataset.amtadd); x.amount.mode = totalSum ? "pct" : "rub"; render(); const i = body.querySelector(`[data-f="amt"][data-id="${x.id}"]`); if (i) i.focus(); return; }
    const ln = t.closest("[data-lnk]"); if (ln) return toggleLink(ln.dataset.lnk);
    const iw = t.closest("[data-insw]"); if (iw) { const [sid, ix] = iw.dataset.insw.split(":"); const st = getRef(sid); if (!st) return; const w = mkW("Новая работа", 3); st.works.splice(+ix, 0, w); render(); return startEdit(w.id); }
    const is = t.closest("[data-inss]"); if (is) { const s = mkS("Новый этап", []); T.stages.splice(+is.dataset.inss, 0, s); render(); return startEdit(s.id); }
  });

  renderStats(); renderGrid();
  // flush — сохранить несохранённое сразу (перед переключением «План / Выполнение»)
  return { cancel: () => clearTimeout(saveT), flush: async () => { if (!saveT) return; clearTimeout(saveT); saveT = null; await opts.onSave(JSON.parse(JSON.stringify({ ...T, scale: ui.scale }))); } };
}

/** Даты строк графика — для синхронизации с таблицей этапов (обзор, дашборд). */
export function gprStageRows(gpr, start) {
  const { res, total } = resolve(gpr), dates = workDates(start, Math.max(1, total));
  return gpr.stages.map((s, i) => { const r = res[s.id]; return { name: s.title || "Этап", start_date: r.dur ? dates[r.start] : dates[Math.min(r.start, dates.length - 1)], end_date: dates[Math.max(r.start, r.end - 1)] || dates[dates.length - 1], days: Math.max(1, r.dur), done: !!s.done, sort: i + 1 }; });
}
export function gprEnd(gpr, start) { const { total } = resolve(gpr); return total ? workDates(start, total)[total - 1] : null; }
