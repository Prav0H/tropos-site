// Настройки: должности и права (как во «Включи систему»), шаблоны задач и применение шаблона к проекту.
import { sb, S, check, loadRefs } from "./db.js?v=15";
import { esc, $, $$, toast, modal, confirmBox, field, formData } from "./ui.js?v=15";
import { today, addWorkdays, nextWorkday, isWorkday } from "./calendar.js?v=15";
import { RESOURCES, closePerms, uncheck, isOwnerP } from "./access.js?v=15";

/* ================= должности и права ================= */
export async function rolesSettings(root, selId) {
  await loadRefs();
  const roles = S.roles;
  let cur = roles.find((r) => r.id === selId) || roles[0] || null;
  const owner = isOwnerP();
  const cnt = (r) => S.people.filter((p) => p.role_id === r.id).length;
  const draw = () => {
    const perms = cur ? closePerms(cur.permissions) : {};
    const groups = [...new Set(RESOURCES.map((r) => r.group))];
    root.innerHTML = `<div class="rl"><div><div class="rl-list">${roles.map((r) => `<button data-r="${r.id}" class="${cur && cur.id === r.id ? "on" : ""}">${esc(r.name)}<small>${cnt(r)} чел.</small></button>`).join("")}</div>
        ${owner ? `<button class="btn" id="nr" style="margin-top:10px;width:100%">+ Должность</button>` : ""}
        <p class="small muted">Владелец видит и меняет всё — ему должность не нужна. Должность человеку ставится во вкладке «Люди».</p></div>
      <div class="card">${cur ? `<div class="row between"><input id="rn" value="${esc(cur.name)}" style="font:700 17px var(--display);border:1px solid transparent;padding:4px 6px;border-radius:6px;min-width:260px"${owner ? "" : " disabled"}>
          ${owner ? `<div class="row"><button class="btn sm" id="rcopy">Копировать</button><button class="btn sm danger" id="rdel">Удалить</button></div>` : ""}</div>
        <p class="small muted" style="margin:6px 0 0">Галочка включает и то, без чего она не работает (например, «Редактирование» включает «Просмотр»). Сохраняется сразу.</p>
        ${groups.map((g) => `<div class="pm-g">${g}</div>${RESOURCES.filter((r) => r.group === g).map((r) => `<div class="pm"><div><b>${r.title}</b><small>${r.desc}</small></div>
          <div class="pm-c">${r.perms.map((p) => { const on = !!(perms[r.key] || {})[p.key]; return `<label class="${on ? "on" : ""}"><input type="checkbox" data-res="${r.key}" data-key="${p.key}"${on ? " checked" : ""}${owner ? "" : " disabled"}>${on ? "✓ " : ""}${p.title}</label>`; }).join("")}</div></div>`).join("")}`).join("")}`
      : `<div class="empty">Должностей нет. Нажмите «+ Должность».</div>`}</div></div>`;
    $$("[data-r]", root).forEach((b) => (b.onclick = () => { cur = roles.find((r) => r.id === b.dataset.r); draw(); }));
    const nr = $("#nr", root); if (nr) nr.onclick = async () => { const r = check(await sb.from("roles").insert({ name: "Новая должность", sort: roles.length + 1, permissions: { dashboard: { watch: true }, tasks: { watchOwn: true, create: true, edit: true } } }).select().single()); roles.push(r); cur = r; draw(); $("#rn", root).select(); };
    if (!cur || !owner) return;
    $("#rn", root).onchange = async (e) => { const name = e.target.value.trim() || "Без названия"; check(await sb.from("roles").update({ name }).eq("id", cur.id)); cur.name = name; draw(); toast("Сохранено"); };
    $("#rcopy", root).onclick = async () => { const r = check(await sb.from("roles").insert({ name: cur.name + " (копия)", sort: roles.length + 1, permissions: cur.permissions }).select().single()); roles.push(r); cur = r; draw(); };
    $("#rdel", root).onclick = async () => { if (!(await confirmBox(`Удалить должность «${cur.name}»? У ${cnt(cur)} чел. должность станет пустой — у них будет доступ ко всему, кроме настроек и удаления.`, "Удалить"))) return; check(await sb.from("roles").delete().eq("id", cur.id)); roles.splice(roles.indexOf(cur), 1); cur = roles[0] || null; draw(); };
    $$("[data-res]", root).forEach((cb) => (cb.onchange = async () => {
      let p = closePerms(cur.permissions);
      if (cb.checked) { p[cb.dataset.res][cb.dataset.key] = true; p = closePerms(p); } else uncheck(p, cb.dataset.res, cb.dataset.key);
      const r = await sb.from("roles").update({ permissions: p }).eq("id", cur.id); if (r.error) return toast(r.error.message, true);
      cur.permissions = p; draw();
    }));
  };
  draw();
}

/* ================= шаблоны задач ================= */
const nid = () => "t" + Math.random().toString(36).slice(2, 9);
const PRIO = [["high", "высокий"], ["medium", "средний"], ["low", "низкий"]];
const count = (t) => (t.stages || []).reduce((a, s) => a + s.tasks.length, 0);

export async function templatesSettings(root, main, openId) {
  await loadRefs();
  const owner = isOwnerP();
  const used = check(await sb.from("projects").select("template_id")).reduce((m, p) => { if (p.template_id) m[p.template_id] = (m[p.template_id] || 0) + 1; return m; }, {});
  if (openId) { const t = S.ttpls.find((x) => x.id === openId); if (t) return templateEditor(root, main, t); }
  root.innerHTML = `<div class="row between" style="margin-bottom:12px"><span class="small muted">Шаблон — этапы и задачи, которые разом ставятся в проект («Проект → Задачи → Шаблон задач»). Исполнитель задачи — по должности.</span>${owner ? `<button class="btn primary" id="nt">+ Шаблон</button>` : ""}</div>
    ${S.ttpls.length ? `<div class="pj-grid">${S.ttpls.map((t) => `<a class="pj" href="javascript:void 0" data-t="${t.id}" style="--pc:#2357f5"><div class="pj-head"><h3>${esc(t.name)}</h3></div>
      <div class="pj-meta"><span>${t.stages.length} этап.</span><span>· ${count(t)} задач</span>${used[t.id] ? `<span>· в ${used[t.id]} проект.</span>` : ""}</div>
      ${t.description ? `<div class="pj-desc">${esc(t.description)}</div>` : ""}${t.source ? `<div class="small muted" style="margin-top:6px">${esc(t.source)}</div>` : ""}</a>`).join("")}</div>` : `<div class="empty">Шаблонов нет.</div>`}`;
  $$("[data-t]", root).forEach((a) => (a.onclick = () => templateEditor(root, main, S.ttpls.find((x) => x.id === a.dataset.t))));
  const nt = $("#nt", root); if (nt) nt.onclick = async () => { const t = check(await sb.from("task_templates").insert({ name: "Новый шаблон", stages: [{ id: nid(), name: "Этап 1", optional: false, trigger: null, tasks: [] }], sort: S.ttpls.length + 1 }).select().single()); await loadRefs(); templateEditor(root, main, S.ttpls.find((x) => x.id === t.id)); };
}

function templateEditor(root, main, src) {
  const T = JSON.parse(JSON.stringify(src)), owner = isOwnerP(), dis = owner ? "" : " disabled";
  let dirty = false;
  const allTasks = () => T.stages.flatMap((s) => s.tasks.map((t) => ({ ...t, stage: s.name })));
  const roleOpts = (v) => `<option value="">— исполнитель: ответственный проекта —</option>${S.roles.map((r) => `<option value="${r.id}"${r.id === v ? " selected" : ""}>${esc(r.name)}</option>`).join("")}`;
  const draw = () => {
    const tasksAll = allTasks();
    root.innerHTML = `<a href="javascript:void 0" class="small" id="back">← Шаблоны задач</a>
      <div class="row between" style="margin:8px 0 12px"><div class="grow" style="min-width:260px"><input id="tn" value="${esc(T.name)}" style="font:700 20px var(--display);border:1px solid var(--line);border-radius:8px;padding:6px 10px;width:100%"${dis}>
        <input id="td" value="${esc(T.description)}" placeholder="Описание шаблона" style="margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;width:100%;font:13px var(--body)"${dis}></div>
        ${owner ? `<div class="row"><button class="btn primary" id="sv">Сохранить</button><button class="btn" id="cp">Копировать</button><button class="btn danger" id="dl">Удалить</button></div>` : ""}</div>
      <p class="small muted" style="margin-top:0">Шаг — порядок внутри этапа (задачи одного шага идут параллельно). Срок — рабочих дней от даты применения (пусто — без срока). Чек-лист — по пункту на строку. ${esc(T.source || "")}</p>
      ${T.stages.map((s, si) => `<div class="tt-st" data-si="${si}"><div class="tt-sh"><b class="small muted">${si + 1}.</b><input class="nm" data-sf="name" value="${esc(s.name)}"${dis}>
          <label class="chk small"><input type="checkbox" data-sf="optional"${s.optional ? " checked" : ""}${dis}> отключаемый</label>
          <select data-sf="trigger" style="max-width:280px;font-size:12.5px"${dis}><option value="">старт: сразу при применении</option>${tasksAll.filter((t) => !s.tasks.some((x) => x.id === t.id)).map((t) => `<option value="${t.id}"${s.trigger === t.id ? " selected" : ""}>после: ${esc(t.title.slice(0, 60))}</option>`).join("")}</select>
          ${owner ? `<button class="btn sm ghost danger" data-sdel>Удалить этап</button>` : ""}</div>
        ${s.tasks.map((t, ti) => `<div class="tt-t" data-ti="${ti}"><input type="number" min="1" data-tf="step" value="${t.step || 1}" title="Шаг"${dis}>
          <div><input data-tf="title" value="${esc(t.title)}" placeholder="Задача"${dis}>
            <div class="tt-more"><textarea data-tf="description" rows="2" placeholder="Описание"${dis}>${esc(t.description || "")}</textarea><textarea data-tf="checklist" rows="2" placeholder="Чек-лист: пункт на строку"${dis}>${esc((t.checklist || []).join("\n"))}</textarea></div>
            ${t.result ? `<div class="small muted" style="margin-top:4px">Результат: ${esc(t.result)}</div>` : ""}</div>
          <div><select data-tf="role_id"${dis}>${roleOpts(t.role_id)}</select><div class="tt-more" style="grid-template-columns:1fr 1fr"><input type="number" min="0" data-tf="deadline" value="${t.deadline ?? ""}" placeholder="срок, дн" title="Срок, рабочих дней"${dis}><select data-tf="priority"${dis}>${PRIO.map(([k, l]) => `<option value="${k}"${t.priority === k ? " selected" : ""}>${l}</option>`).join("")}</select></div></div>
          ${owner ? `<button class="x" data-tdel title="Удалить задачу">🗑</button>` : "<span></span>"}</div>`).join("")}
        ${owner ? `<div style="padding:8px 12px;border-top:1px solid var(--line)"><button class="btn sm" data-tadd>+ Задача</button></div>` : ""}</div>`).join("")}
      ${owner ? `<button class="btn" id="sadd">+ Этап</button>` : ""}`;
    $("#back", root).onclick = async () => { if (dirty && !(await confirmBox("Есть несохранённые изменения. Выйти без сохранения?", "Выйти"))) return; templatesSettings(root, main); };
    if (!owner) return;
    const mark = () => { dirty = true; $("#sv", root).textContent = "Сохранить •"; };
    $("#tn", root).oninput = (e) => { T.name = e.target.value; mark(); };
    $("#td", root).oninput = (e) => { T.description = e.target.value; mark(); };
    $$("[data-si]", root).forEach((box) => {
      const s = T.stages[+box.dataset.si];
      $$("[data-sf]", box).forEach((el) => (el.onchange = () => { const f = el.dataset.sf; s[f] = el.type === "checkbox" ? el.checked : f === "trigger" ? el.value || null : el.value; mark(); }));
      $$("[data-ti]", box).forEach((row) => {
        const t = s.tasks[+row.dataset.ti];
        $$("[data-tf]", row).forEach((el) => (el.onchange = () => {
          const f = el.dataset.tf, v = el.value;
          if (f === "checklist") t.checklist = v.split("\n").map((x) => x.trim()).filter(Boolean);
          else if (f === "step") t.step = Math.max(1, +v || 1);
          else if (f === "deadline") t.deadline = v === "" ? null : Math.max(0, +v);
          else if (f === "role_id") t.role_id = v || null;
          else t[f] = v;
          mark();
        }));
        $("[data-tdel]", row).onclick = () => { s.tasks.splice(+row.dataset.ti, 1); T.stages.forEach((x) => { if (x.trigger === t.id) x.trigger = null; x.tasks.forEach((y) => (y.deps = (y.deps || []).filter((d) => d !== t.id))); }); mark(); draw(); };
      });
      $("[data-tadd]", box).onclick = () => { const last = s.tasks[s.tasks.length - 1]; s.tasks.push({ id: nid(), title: "", description: "", result: "", checklist: [], priority: "medium", step: last ? last.step : 1, deadline: null, role_id: null, deps: [] }); mark(); draw(); const ins = $$(`[data-si="${box.dataset.si}"] [data-tf=title]`, root); ins[ins.length - 1].focus(); };
      $("[data-sdel]", box).onclick = async () => { if (s.tasks.length && !(await confirmBox(`Удалить этап «${s.name}» и ${s.tasks.length} задач?`, "Удалить"))) return; T.stages.splice(+box.dataset.si, 1); mark(); draw(); };
    });
    $("#sadd", root).onclick = () => { T.stages.push({ id: nid(), name: "Новый этап", optional: true, trigger: null, tasks: [] }); mark(); draw(); };
    $("#sv", root).onclick = async () => {
      T.stages.forEach((s) => (s.tasks = s.tasks.filter((t) => t.title.trim())));
      const r = await sb.from("task_templates").update({ name: T.name.trim() || "Без названия", description: T.description, stages: T.stages }).eq("id", T.id);
      if (r.error) return toast(r.error.message, true); dirty = false; await loadRefs(); toast("Шаблон сохранён"); draw();
    };
    $("#cp", root).onclick = async () => { const r = check(await sb.from("task_templates").insert({ name: T.name + " (копия)", description: T.description, source: T.source, stages: T.stages, sort: S.ttpls.length + 1 }).select().single()); await loadRefs(); templateEditor(root, main, S.ttpls.find((x) => x.id === r.id)); toast("Создана копия — удалите лишнее"); };
    $("#dl", root).onclick = async () => { if (!(await confirmBox(`Удалить шаблон «${T.name}»? Задачи, уже поставленные в проекты, останутся.`, "Удалить"))) return; check(await sb.from("task_templates").delete().eq("id", T.id)); await loadRefs(); templatesSettings(root, main); };
  };
  draw();
}

/* ================= применить шаблон к проекту ================= */
export function applyTemplateDialog(project, done) {
  if (!S.ttpls.length) return toast("Шаблонов задач нет — создайте в «Настройки → Шаблоны задач»", true);
  const start0 = project.start_date || nextWorkday(today());
  modal({
    title: "Поставить задачи из шаблона",
    wide: true,
    body: `${field("Шаблон", "tpl", project.template_id || S.ttpls[0].id, { options: S.ttpls.map((t) => [t.id, `${t.name} — ${count(t)} задач`]) })}
      ${field("Дата отсчёта сроков", "start", start0, { type: "date", hint: "Срок задачи = эта дата + «срок, дн» из шаблона (рабочие дни)" })}
      <div class="sec-t" style="margin-top:8px">Этапы</div><div id="stl"></div>`,
    footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Поставить задачи</button>`,
    onMount: (el, close) => {
      const sel = el.querySelector("[name=tpl]");
      const drawSt = () => { const t = S.ttpls.find((x) => x.id === sel.value); el.querySelector("#stl").innerHTML = t.stages.map((s, i) => `<label class="chk"><input type="checkbox" data-st="${i}" checked${s.optional ? "" : " disabled"}> ${esc(s.name)} <span class="small muted">· ${s.tasks.length} задач${s.optional ? "" : " · обязательный"}</span></label>`).join(""); };
      sel.onchange = drawSt; drawSt();
      el.querySelector("[data-ok]").onclick = async () => {
        const t = S.ttpls.find((x) => x.id === sel.value);
        let start = el.querySelector("[name=start]").value || start0; if (!isWorkday(start)) start = nextWorkday(start);
        const on = new Set($$("[data-st]", el).filter((c) => c.checked).map((c) => +c.dataset.st));
        const who = (roleId) => { if (!roleId) return project.responsible || null; const p = S.people.find((x) => x.role_id === roleId && x.active !== false); return p ? p.id : project.responsible || null; };
        const rows = [];
        t.stages.forEach((s, i) => { if (!on.has(i)) return; s.tasks.forEach((k) => rows.push({
          project_id: project.id, title: k.title, priority: k.priority || "medium", assignee: who(k.role_id), stage_name: s.name, step: k.step || 1,
          description: [k.description, k.result ? "Результат: " + k.result : ""].filter(Boolean).join("\n\n"),
          checklist: (k.checklist || []).map((x) => ({ t: x, done: false })),
          due_at: k.deadline != null ? new Date(`${k.deadline === 0 ? start : addWorkdays(start, k.deadline)}T18:00:00`).toISOString() : null,
        })); });
        if (!rows.length) return toast("Нет задач для постановки", true);
        const had = check(await sb.from("tasks").select("id").eq("project_id", project.id).neq("stage_name", "").is("gpr_id", null).limit(1));
        if (had.length && !(await confirmBox("В проекте уже есть задачи из шаблона. Поставить ещё раз? Задачи продублируются.", "Поставить ещё раз"))) return;
        const r = await sb.from("tasks").insert(rows); if (r.error) return toast(r.error.message, true);
        await sb.from("projects").update({ template_id: t.id }).eq("id", project.id);
        close(); toast(`Поставлено задач: ${rows.length}`); done && done();
      };
    },
  });
}
