// Оргсхема: дерево подразделений; внутри подразделения — должности (функции) списком, у должности могут быть подфункции.
// На одну должность — сколько угодно людей. Кнопки добавления и правки видны только в режиме редактирования.
import { sb, S, check, personName } from "./db.js?v=15";
import { esc, $, $$, toast, modal, field, formData } from "./ui.js?v=15";
import { can } from "./access.js?v=15";
import { delRec } from "./del.js?v=15";

const COLORS = ["#2357f5", "#ff9a1f", "#1d7f55", "#e8432e", "#8b5cf6", "#0ea5b7", "#a8600e", "#6b6a68"];
const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const shortName = (id) => personName(id).split(/\s+/).slice(0, 2).join(" ");
const ava = (id) => (id ? `<span class="tk-ava" title="${esc(personName(id))}">${esc(initials(personName(id)))}</span>` : `<span class="tk-ava none" title="Не назначен">?</span>`);
const people = () => S.people.filter((p) => p.active !== false);
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("tr_org_" + k); localStorage.setItem("tr_org_" + k, v); } catch (e) { return null; } };
const UI = { edit: false };

export async function orgPage(main) {
  const [U, F] = await Promise.all([sb.from("org_units").select("*").order("sort").order("created_at"), sb.from("org_functions").select("*").order("sort").order("created_at")]).then((r) => r.map(check));
  F.forEach((f) => { f.person_ids = f.person_ids && f.person_ids.length ? f.person_ids : f.person_id ? [f.person_id] : []; });
  const mayEdit = can("org", "edit"), mayDel = can("org", "delete");
  const E = UI.edit && mayEdit;
  const re = () => orgPage(main);
  const view = pref("view") === "people" ? "people" : "tree";
  const kids = (id) => U.filter((u) => (u.parent_id || null) === id);
  const fnTop = (uid) => F.filter((f) => f.unit_id === uid && !f.parent_id);
  const fnSub = (fid) => F.filter((f) => f.parent_id === fid);
  const depth = (u) => { let n = 0, x = u; while (x && x.parent_id) { x = U.find((y) => y.id === x.parent_id); n++; } return n; };
  const pathOf = (u) => { const out = []; let x = u; while (x) { out.unshift(x.name); x = U.find((y) => y.id === x.parent_id); } return out.join(" → "); };
  const isUnder = (x, rootId) => { let y = x; while (y && y.parent_id) { if (y.parent_id === rootId) return true; y = U.find((z) => z.id === y.parent_id); } return false; };

  const fnItem = (f, lvl = 0) => `<li class="org-f lvl${lvl}" data-f="${f.id}" title="${esc(f.duties || "")}">
      <div class="org-fr"><span class="org-ft">${esc(f.title)}</span>
        <span class="org-fp">${f.person_ids.length ? f.person_ids.map((p) => `<em>${esc(shortName(p))}</em>`).join("") : `<em class="org-miss">нет</em>`}</span></div>
      ${E ? `<div class="org-fa"><button data-fsub="${f.id}" title="Подфункция">+ подфункция</button></div>` : ""}
      ${fnSub(f.id).length ? `<ul class="org-sub">${fnSub(f.id).map((x) => fnItem(x, lvl + 1)).join("")}</ul>` : ""}</li>`;
  const unitCard = (u) => {
    const fs = fnTop(u.id), ch = kids(u.id);
    return `<li><div class="org-u" style="--uc:${esc(u.color)}">
        <div class="org-uh"><b>${esc(u.name)}</b>${E ? `<button class="org-ic" data-ue="${u.id}" title="Изменить подразделение">✎</button>` : ""}</div>
        ${u.goal ? `<div class="org-goal" title="${esc(u.goal)}">${esc(u.goal)}</div>` : ""}
        <div class="org-head">${ava(u.head_id)}<div><small>${esc(u.head_title || "Руководитель")}</small>${u.head_id ? esc(personName(u.head_id)) : `<span class="org-miss">не назначен</span>`}</div></div>
        ${fs.length ? `<ul class="org-fs">${fs.map((f) => fnItem(f)).join("")}</ul>` : E ? "" : `<div class="org-empty">Должностей нет</div>`}
        ${E ? `<div class="org-add"><button data-fadd="${u.id}">+ должность</button><button data-uadd="${u.id}">+ подразделение</button></div>` : ""}
      </div>${ch.length ? `<ul>${ch.map(unitCard).join("")}</ul>` : ""}</li>`;
  };
  const roots = kids(null);
  const assigned = (pid) => F.filter((f) => f.person_ids.includes(pid));
  const emptyF = F.filter((f) => !f.person_ids.length), noHead = U.filter((u) => !u.head_id);
  const inSchema = people().filter((p) => assigned(p.id).length || U.some((u) => u.head_id === p.id));
  const free = people().filter((p) => !inSchema.includes(p));

  main.innerHTML = `<div class="page-head"><div><h1>Оргсхема</h1><div class="small muted" style="margin-top:4px">Подразделения, руководители, должности и кто их занимает.</div></div>
      <div class="row"><div class="seg"><button data-v="tree" class="${view === "tree" ? "on" : ""}">Схема</button><button data-v="people" class="${view === "people" ? "on" : ""}">По людям</button></div>
      ${mayEdit ? (E ? `<button class="btn" data-uadd="">+ Подразделение</button><button class="btn primary" data-edit>✓ Сохранить</button>` : `<button class="btn" data-edit>✎ Редактировать</button>`) : ""}</div></div>
    ${E ? `<div class="dash-note">Режим редактирования. ✎ — изменить подразделение, нажмите на должность — изменить её и людей. «+ подфункция» добавляет строку под должностью. Всё сохраняется сразу; «Сохранить» убирает кнопки.</div>` : ""}
    <div class="grid4" style="margin-bottom:14px">
      <div class="card kpi"><div class="small muted">Подразделений</div><div class="v">${U.length}</div><div class="s">${noHead.length ? `руководитель не назначен: ${noHead.length}` : "у всех назначен руководитель"}</div></div>
      <div class="card kpi"><div class="small muted">Должностей</div><div class="v">${F.length}</div><div class="s">${emptyF.length ? `никто не занимает: ${emptyF.length}` : F.length ? "все заняты" : "добавьте в режиме редактирования"}</div></div>
      <div class="card kpi"><div class="small muted">Людей в схеме</div><div class="v">${inSchema.length}</div><div class="s">${free.length ? `вне схемы: ${free.length}` : "все на местах"}</div></div>
      <div class="card kpi"><div class="small muted">Больше всего должностей</div>${(() => { const top = inSchema.slice().sort((a, b) => assigned(b.id).length - assigned(a.id).length)[0]; return top ? `<div class="v" style="font-size:17px">${esc(shortName(top.id))}</div><div class="s">${assigned(top.id).length} должн.</div>` : `<div class="v">—</div>`; })()}</div></div>
    <div id="ob"></div>`;
  const ob = $("#ob", main);
  if (view === "tree") {
    ob.innerHTML = roots.length ? `<div class="card flush org-wrap${E ? " editing" : ""}"><div class="org-tree"><ul>${roots.map(unitCard).join("")}</ul></div></div>
      <p class="small muted">Наведите на должность — увидите, что она делает. Схему можно таскать мышкой в любую сторону.</p>`
      : `<div class="empty">Схема пуста.${mayEdit ? " Нажмите «✎ Редактировать», затем «+ Подразделение»." : ""}</div>`;
  } else {
    ob.innerHTML = `<div class="card flush"><div class="tw"><table class="t"><tr><th>Человек</th><th>Руководящие должности</th><th>Должности</th></tr>
      ${inSchema.map((p) => `<tr><td class="nowrap">${ava(p.id)} ${esc(p.name)}</td><td>${U.filter((u) => u.head_id === p.id).map((u) => `<span class="st acc">${esc(u.head_title || "Руководитель")} · ${esc(u.name)}</span>`).join(" ") || `<span class="muted">—</span>`}</td><td class="small">${assigned(p.id).map((f) => `<b>${esc(f.title)}</b> <span class="muted">· ${esc(pathOf(U.find((u) => u.id === f.unit_id)))}</span>`).join("<br>") || "—"}</td></tr>`).join("")}
      ${free.map((p) => `<tr><td class="nowrap">${ava(p.id)} ${esc(p.name)}</td><td colspan="2" class="muted small">в схеме нет</td></tr>`).join("")}</table></div></div>
      ${emptyF.length ? `<div class="card" style="margin-top:14px"><div class="sec-t">Должности, которые никто не занимает · ${emptyF.length}</div>${emptyF.map((f) => `<div class="row between small" style="padding:4px 0;border-bottom:1px solid var(--line)"><span><b>${esc(f.title)}</b> <span class="muted">· ${esc(pathOf(U.find((u) => u.id === f.unit_id)))}</span></span>${mayEdit ? `<button class="btn sm" data-f="${f.id}">Назначить</button>` : ""}</div>`).join("")}</div>` : ""}`;
  }

  /* ---------- формы ---------- */
  const unitOpts = () => U.slice().sort((a, b) => pathOf(a).localeCompare(pathOf(b))).map((x) => [x.id, "  ".repeat(depth(x)) + x.name]);
  const unitForm = (u) => modal({
    title: u.id ? u.name : "Новое подразделение",
    body: `${field("Название", "name", u.name, { req: true, ph: "Отдел продаж" })}
      ${field("Продукт подразделения — что оно выдаёт на выходе", "goal", u.goal, { rows: 2, ph: "Подписанный договор и оплата" })}
      <div class="grid2">${field("Должность руководителя", "head_title", u.head_title, { req: true, ph: "Коммерческий директор" })}${field("Кто занимает", "head_id", u.head_id || "", { options: [["", "— не назначен —"], ...people().map((p) => [p.id, p.name])] })}</div><div class="grid2">${field("Входит в", "parent_id", u.parent_id || "", { options: [["", "— верхний уровень —"], ...unitOpts().filter(([id]) => id !== u.id && !isUnder(U.find((x) => x.id === id), u.id))] })}</div>
      <div><div class="small muted" style="margin-bottom:6px">Цвет</div><div class="row" style="gap:6px">${COLORS.map((c) => `<label class="org-col"><input type="radio" name="color" value="${c}"${(u.color || COLORS[0]) === c ? " checked" : ""}><i style="background:${c}"></i></label>`).join("")}</div></div>`,
    footer: `${u.id && mayDel ? `<button class="btn danger" data-del>Удалить</button>` : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
    onMount: (el, close) => {
      el.querySelector("[data-ok]").onclick = async () => {
        const v = formData(el); v.color = (el.querySelector("[name=color]:checked") || {}).value || COLORS[0];
        if (!v.name) return toast("Укажите название", true);
        if (!v.head_title) return toast("Впишите должность руководителя", true);
        v.head_id = v.head_id || null; v.parent_id = v.parent_id || null;
        const r = u.id ? await sb.from("org_units").update(v).eq("id", u.id) : await sb.from("org_units").insert({ ...v, sort: kids(v.parent_id).length + 1 });
        if (r.error) return toast(r.error.message, true); close(); re();
      };
      const d = el.querySelector("[data-del]"); if (d) d.onclick = () => { const ids = U.filter((x) => x.id === u.id || isUnder(x, u.id)).map((x) => x.id); close(); delRec({ table: "org_units", id: u.id, what: `подразделение «${u.name}»`, warn: ids.length > 1 || F.some((f) => ids.includes(f.unit_id)) ? `Вместе с ним удалятся вложенные подразделения (${ids.length - 1}) и должности (${F.filter((f) => ids.includes(f.unit_id)).length}).` : "", done: re }); };
    },
  });
  const fnForm = (f) => {
    const ro = !E;
    const parent = f.parent_id ? F.find((x) => x.id === f.parent_id) : null;
    modal({
      title: f.id ? f.title : parent ? `Подфункция: ${parent.title}` : "Новая должность",
      body: ro ? `<div class="small muted">${esc(pathOf(U.find((u) => u.id === f.unit_id)))}${parent ? " → " + esc(parent.title) : ""}</div>
          ${f.duties ? `<div style="white-space:pre-wrap">${esc(f.duties)}</div>` : `<div class="muted">Обязанности не описаны</div>`}
          <div><div class="sec-t">Кто занимает</div>${f.person_ids.length ? f.person_ids.map((p) => `<div class="row" style="gap:8px;margin-bottom:6px">${ava(p)} ${esc(personName(p))}</div>`).join("") : `<span class="org-miss">никто</span>`}</div>`
        : `${field(parent ? "Подфункция" : "Должность", "title", f.title, { req: true, ph: parent ? "Например: ведёт базу клиентов" : "Менеджер по продажам" })}
          ${field("Что делает и за что отвечает", "duties", f.duties, { rows: 4, ph: "Ведёт сделки от квалификации до оплаты; результат — подписанный договор" })}
          <div><div class="small muted" style="margin-bottom:6px">Кто занимает — можно несколько человек</div><div class="org-ppl">${people().map((p) => `<label class="chk"><input type="checkbox" data-pp="${p.id}"${f.person_ids.includes(p.id) ? " checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>
          ${parent ? "" : field("Подразделение", "unit_id", f.unit_id, { options: unitOpts() })}`,
      footer: ro ? `<button class="btn" data-close>Закрыть</button>` : `${f.id && mayDel ? `<button class="btn danger" data-del>Удалить</button>` : ""}<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>`,
      onMount: (el, close) => {
        const ok = el.querySelector("[data-ok]"); if (ok) ok.onclick = async () => {
          const v = formData(el); if (!v.title) return toast("Впишите название", true);
          const row = { title: v.title, duties: v.duties || "", person_ids: $$("[data-pp]", el).filter((c) => c.checked).map((c) => c.dataset.pp), unit_id: parent ? parent.unit_id : v.unit_id || f.unit_id, parent_id: f.parent_id || null };
          row.person_id = row.person_ids[0] || null;
          const r = f.id ? await sb.from("org_functions").update(row).eq("id", f.id) : await sb.from("org_functions").insert({ ...row, sort: F.filter((x) => x.unit_id === row.unit_id && (x.parent_id || null) === row.parent_id).length + 1 });
          if (r.error) return toast(r.error.message, true); close(); re();
        };
        const d = el.querySelector("[data-del]"); if (d) d.onclick = () => { close(); const n = F.filter((x) => x.parent_id === f.id).length; delRec({ table: "org_functions", id: f.id, what: `«${f.title}»`, warn: n ? `Вместе с ней удалятся подфункции (${n}).` : "", done: re }); };
      },
    });
  };

  $$("[data-v]", main).forEach((b) => (b.onclick = () => { pref("view", b.dataset.v); re(); }));
  const eb = $("[data-edit]", main); if (eb) eb.onclick = () => { UI.edit = !UI.edit; if (!UI.edit) toast("Сохранено"); re(); };
  $$("[data-uadd]", main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); unitForm({ parent_id: b.dataset.uadd || null, color: b.dataset.uadd ? (U.find((x) => x.id === b.dataset.uadd) || {}).color : COLORS[U.length % COLORS.length] }); }));
  $$("[data-ue]", main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); unitForm(U.find((x) => x.id === b.dataset.ue)); }));
  $$("[data-fadd]", main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); fnForm({ unit_id: b.dataset.fadd, person_ids: [] }); }));
  $$("[data-fsub]", main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const p = F.find((x) => x.id === b.dataset.fsub); fnForm({ unit_id: p.unit_id, parent_id: p.id, person_ids: [] }); }));
  $$("[data-f]", main).forEach((li) => (li.onclick = (e) => { if (e.target.closest("button")) return; e.stopPropagation(); fnForm(F.find((x) => x.id === li.dataset.f)); }));

  // схему таскают мышкой: вбок — внутри рамки, вверх-вниз — вся страница
  const w = $(".org-wrap", main);
  if (w) {
    let dr = null;
    w.onmousedown = (e) => { if (e.button !== 0 || e.target.closest("button,li[data-f],a,input")) return; dr = { x: e.clientX, y: e.clientY, l: w.scrollLeft, t: window.scrollY }; w.classList.add("grab"); e.preventDefault(); };
    const move = (e) => { if (!dr) return; w.scrollLeft = dr.l - (e.clientX - dr.x); window.scrollTo(0, dr.t - (e.clientY - dr.y)); };
    const up = () => { dr = null; w.classList.remove("grab"); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    const stop = () => { if (!document.body.contains(w)) { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); clearInterval(t); } };
    const t = setInterval(stop, 2000);
    // показать середину схемы
    w.scrollLeft = Math.max(0, (w.scrollWidth - w.clientWidth) / 2);
  }
}
