// Календарь встреч: неделя по часам, встречи и занятость сотрудников; настройки записи; подключение Telegram.
import { sb, S, check, personName, loadRefs } from "./db.js?v=15";
import { esc, d, $, $$, toast, modal, field, formData, busy } from "./ui.js?v=15";
import { today, iso, addDays } from "./calendar.js?v=15";
import { can, isOwnerP } from "./access.js?v=15";
import { delRec } from "./del.js?v=15";

const COLORS = ["#2357f5", "#1d7f55", "#8b5cf6", "#e8432e", "#0ea5b7", "#a8600e", "#b5476f", "#6b6a68"];
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const ST = { planned: ["Запланирована", "info"], done: ["Проведена", "good"], cancelled: ["Отменена", ""], noshow: ["Не пришёл", "bad"] };
const BOT = "mytroposbot";
const Q_URL = location.origin + location.pathname.replace(/[^/]*$/, "") + "q.html";
const pad = (n) => String(n).padStart(2, "0");
const hm = (x) => `${pad(x.getHours())}:${pad(x.getMinutes())}`;
const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
const monday = (s) => { const x = new Date(s + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
const cfg = () => Object.assign({ from: "07:00", to: "21:00", dur: 60, gap: 15, days: 14, notice: 3, link: "" }, (S.settings.options || {}).calendar || {});
const UI = { week: null, who: "" };

export async function calendarPage(main) {
  await loadRefs();
  UI.week = UI.week || monday(today());
  const C = cfg(), w0 = UI.week, w1 = addDays(w0, 7);
  const [M, B] = await Promise.all([
    sb.from("meetings").select("*").gte("end_at", new Date(w0 + "T00:00:00").toISOString()).lt("start_at", new Date(w1 + "T00:00:00").toISOString()).order("start_at"),
    sb.from("busy").select("*"),
  ]).then((r) => r.map(check));
  const people = S.people.filter((p) => p.active !== false);
  const color = (id) => { const i = people.findIndex((p) => p.id === id); return i < 0 ? "#6b6a68" : COLORS[i % COLORS.length]; };
  const takers = people.filter((p) => p.takes_leads);
  // занятость на неделю: разовые и еженедельные
  const busyIv = [];
  B.forEach((b) => {
    if (b.kind === "once") { const s = new Date(b.start_at), e = new Date(b.end_at); if (e > new Date(w0 + "T00:00:00") && s < new Date(w1 + "T00:00:00")) busyIv.push({ b, s, e }); }
    else for (let k = 0; k < 7; k++) { const day = addDays(w0, k); if (((new Date(day + "T12:00:00").getDay() + 6) % 7) + 1 === b.weekday) busyIv.push({ b, s: new Date(`${day}T${String(b.t_from).slice(0, 5)}:00`), e: new Date(`${day}T${String(b.t_to).slice(0, 5)}:00`) }); }
  });
  const show = (pid) => !UI.who || pid === UI.who || (UI.who === "none" && !pid);
  const h0 = Math.min(toMin(C.from), 7 * 60), h1 = Math.max(toMin(C.to), 21 * 60), PXM = 0.7; // пикселей на минуту
  const days = [...Array(7)].map((_, k) => addDays(w0, k));
  const top = (x) => (x.getHours() * 60 + x.getMinutes() - h0) * PXM;
  const upcoming = M.filter((m) => m.status === "planned" && new Date(m.end_at) > new Date());
  const unclaimed = upcoming.filter((m) => !m.person_id);
  const edit = can("calendar", "edit"), create = can("calendar", "create");

  main.innerHTML = `<div class="page-head"><div><h1>Календарь</h1><div class="small muted" style="margin-top:4px">Встречи с клиентами и занятость. Клиенты записываются сами на свободное время с ${esc(C.from)} до ${esc(C.to)}.</div></div>
      <div class="row"><button class="btn" id="qlink" title="Страница, на которой клиент отвечает на вопросы и записывается">🔗 Ссылка для клиентов</button>${edit ? `<button class="btn" id="cset">⚙ Настройки</button>` : ""}<button class="btn" id="nbusy">Я занят…</button>${create ? `<button class="btn primary" id="nmeet">+ Встреча</button>` : ""}</div></div>
    ${unclaimed.length ? `<div class="note" style="margin-bottom:12px">Встреч без ведущего: <b>${unclaimed.length}</b>. Возьмите в Telegram или назначьте здесь — нажмите на встречу.</div>` : ""}
    ${!takers.length ? `<div class="note" style="margin-bottom:12px">Никто не отмечен как принимающий заявки — клиенты не увидят свободного времени. Отметьте людей в «⚙ Настройки».</div>` : ""}
    <div class="cal-bar"><div class="row" style="gap:6px"><button class="btn sm" id="pw">‹</button><b class="cal-wk">${+w0.slice(8)} ${MON[+w0.slice(5, 7) - 1]} — ${+addDays(w0, 6).slice(8)} ${MON[+addDays(w0, 6).slice(5, 7) - 1]}</b><button class="btn sm" id="nw">›</button><button class="btn sm ghost" id="tw">Сегодня</button></div>
      <div class="wf" style="margin:0"><button data-who="" class="${!UI.who ? "on" : ""}">Все</button>${people.filter((p) => p.takes_leads || M.some((m) => m.person_id === p.id) || B.some((b) => b.person_id === p.id)).map((p) => `<button data-who="${p.id}" class="${UI.who === p.id ? "on" : ""}"><i class="cal-dot" style="background:${color(p.id)}"></i>${esc(p.name.split(/\s+/).slice(0, 2).join(" "))}</button>`).join("")}<button data-who="none" class="${UI.who === "none" ? "on" : ""}"><i class="cal-dot" style="background:var(--orange)"></i>Никто не взял</button></div></div>
    <div class="card flush cal-wrap"><div class="cal-g" style="--h:${(h1 - h0) * PXM}px">
      <div class="cal-hd"></div>${days.map((day, k) => `<div class="cal-hd${day === today() ? " now" : ""}">${WD[k]} <b>${+day.slice(8)}</b></div>`).join("")}
      <div class="cal-hours">${[...Array(Math.ceil((h1 - h0) / 60))].map((_, i) => `<span style="top:${i * 60 * PXM}px">${pad(Math.floor(h0 / 60) + i)}:00</span>`).join("")}</div>
      ${days.map((day) => {
        const ms = M.filter((m) => iso(new Date(m.start_at)) === day && show(m.person_id) && m.status !== "cancelled");
        const bs = busyIv.filter((x) => iso(x.s) === day && show(x.b.person_id));
        const offA = toMin(C.from), offB = toMin(C.to);
        return `<div class="cal-col${day === today() ? " now" : ""}" data-day="${day}">
          <i class="cal-off" style="top:0;height:${(offA - h0) * PXM}px"></i><i class="cal-off" style="top:${(offB - h0) * PXM}px;bottom:0"></i>
          ${bs.map((x) => `<div class="cal-busy" data-busy="${x.b.id}" style="top:${top(x.s)}px;height:${Math.max(14, (x.e - x.s) / 6e4 * PXM)}px;--c:${color(x.b.person_id)}" title="${esc(personName(x.b.person_id))} занят ${hm(x.s)}–${hm(x.e)}${x.b.note ? ": " + esc(x.b.note) : ""}${x.b.kind === "weekly" ? " (каждую неделю)" : ""}"><span>${esc(personName(x.b.person_id).split(/\s+/)[1] || personName(x.b.person_id))}${x.b.note ? " · " + esc(x.b.note) : ""}</span></div>`).join("")}
          ${ms.map((m) => { const s = new Date(m.start_at), e = new Date(m.end_at); return `<div class="cal-m${m.person_id ? "" : " free"} st-${m.status}" data-meet="${m.id}" style="top:${top(s)}px;height:${Math.max(20, (e - s) / 6e4 * PXM)}px;--c:${m.person_id ? color(m.person_id) : "var(--orange)"}"><b>${hm(s)}–${hm(e)}</b><span>${esc(m.client_name || m.title)}</span><small>${m.person_id ? esc(personName(m.person_id)) : "никто не взял"}</small></div>`; }).join("")}
          ${day === today() ? `<u class="cal-now" style="top:${top(new Date())}px"></u>` : ""}
        </div>`; }).join("")}
    </div></div>
    <div class="card flush" style="margin-top:14px"><div class="acc-h"><div class="sec-t" style="margin:0">Ближайшие встречи</div></div>
      ${upcoming.length ? `<div class="tw"><table class="t">${upcoming.map((m) => `<tr class="click" data-meet="${m.id}"><td class="nowrap">${d(iso(new Date(m.start_at))).slice(0, 5)}, ${hm(new Date(m.start_at))}</td><td><b>${esc(m.client_name || m.title)}</b><div class="small muted">${esc(m.contact)}</div></td><td>${m.person_id ? esc(personName(m.person_id)) : `<span class="st warn">никто не взял</span>`}</td><td class="small">${m.source === "qualifier" ? "записался сам" : ""}</td></tr>`).join("")}</table></div>` : `<div class="empty" style="border:0">На этой неделе встреч нет</div>`}</div>`;

  const re = () => calendarPage(main);
  $("#pw", main).onclick = () => { UI.week = addDays(UI.week, -7); re(); };
  $("#nw", main).onclick = () => { UI.week = addDays(UI.week, 7); re(); };
  $("#tw", main).onclick = () => { UI.week = monday(today()); re(); };
  $$("[data-who]", main).forEach((b) => (b.onclick = () => { UI.who = b.dataset.who; re(); }));
  $("#qlink", main).onclick = () => modal({ title: "Ссылка для клиентов", body: `<p class="small muted" style="margin:0">Клиент открывает страницу, отвечает на вопросы и сам выбирает время встречи. Сделка появляется в «Продажах», а вам и коллегам приходит уведомление в Telegram.</p><textarea rows="2" readonly id="ql">${esc(Q_URL)}</textarea>`,
    footer: `<a class="btn" href="${esc(Q_URL)}" target="_blank" rel="noopener">Открыть</a><button class="btn primary" data-cp>Скопировать</button>`,
    onMount: (el) => (el.querySelector("[data-cp]").onclick = async () => { try { await navigator.clipboard.writeText(Q_URL); toast("Ссылка скопирована"); } catch (e) { el.querySelector("#ql").select(); toast("Выделено — нажмите Ctrl+C"); } }) });
  const cs = $("#cset", main); if (cs) cs.onclick = () => settingsForm(re);
  $("#nbusy", main).onclick = () => busyForm({ person_id: S.profile.person_id, kind: "once", date: today(), from: "13:00", to: "14:00" }, re);
  const nm = $("#nmeet", main); if (nm) nm.onclick = () => meetForm({ date: today(), from: "12:00", person_id: S.profile.person_id }, re);
  $$("[data-meet]", main).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); meetForm(M.find((m) => m.id === el.dataset.meet), re); }));
  $$("[data-busy]", main).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); const b = B.find((x) => x.id === el.dataset.busy); busyForm({ ...b, date: b.start_at ? iso(new Date(b.start_at)) : today(), from: b.start_at ? hm(new Date(b.start_at)) : String(b.t_from).slice(0, 5), to: b.end_at ? hm(new Date(b.end_at)) : String(b.t_to).slice(0, 5) }, re); }));
  $$(".cal-col", main).forEach((col) => (col.onclick = (e) => {
    if (e.target.closest("[data-meet],[data-busy]")) return;
    const r = col.getBoundingClientRect(), min = Math.round(((e.clientY - r.top) / PXM + h0) / 30) * 30, from = `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
    const to = `${pad(Math.floor((min + C.dur) / 60) % 24)}:${pad((min + C.dur) % 60)}`;
    modal({ title: `${d(col.dataset.day)}, ${from}`, body: `<p style="margin:0">Что добавить?</p>`, footer: `<button class="btn" data-b>Я занят в это время</button>${create ? `<button class="btn primary" data-m>Встреча</button>` : ""}`,
      onMount: (el, close) => { el.querySelector("[data-b]").onclick = () => { close(); busyForm({ person_id: S.profile.person_id, kind: "once", date: col.dataset.day, from, to }, re); }; const m = el.querySelector("[data-m]"); if (m) m.onclick = () => { close(); meetForm({ date: col.dataset.day, from, person_id: S.profile.person_id }, re); }; } });
  }));
}

/* ---------- встреча ---------- */
function meetForm(m, done) {
  const C = cfg(), s = m.start_at ? new Date(m.start_at) : null, e = m.end_at ? new Date(m.end_at) : null;
  const date = s ? iso(s) : m.date, from = s ? hm(s) : m.from, to = e ? hm(e) : (() => { const x = toMin(m.from) + C.dur; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; })();
  const ro = m.id && !can("calendar", "edit") && m.person_id !== S.profile.person_id;
  modal({
    title: m.id ? m.title : "Новая встреча", wide: true,
    body: `${m.source === "qualifier" ? `<div class="note info">Клиент записался сам через страницу-квалификатор.</div>` : ""}
      <div class="grid3">${field("Дата", "date", date, { type: "date" })}${field("Начало", "from", from, { type: "time" })}${field("Конец", "to", to, { type: "time" })}</div>
      <div class="grid2">${field("Название", "title", m.title || "Встреча")}${field("Кто проводит", "person_id", m.person_id || "", { options: [["", "— никто не взял —"], ...S.people.filter((p) => p.active !== false).map((p) => [p.id, p.name])] })}</div>
      <div class="grid2">${field("Клиент", "client_name", m.client_name)}${field("Контакт", "contact", m.contact)}</div>
      ${field("Ссылка на встречу", "link", m.id ? m.link : C.link, { ph: "https://telemost.yandex.ru/…" })}
      ${field("Заметки", "note", m.note, { rows: 4 })}
      ${m.id ? field("Статус", "status", m.status, { options: Object.entries(ST).map(([k, [l]]) => [k, l]) }) : ""}
      ${m.deal_id ? `<a href="#/deals" data-deal="${m.deal_id}" class="small">Открыть сделку →</a>` : ""}`,
    footer: `${m.id ? (can("calendar", "delete") ? `<button class="btn danger" data-del>Удалить</button>` : "") : ""}<button class="btn" data-close>Отмена</button>${ro ? "" : `<button class="btn primary" data-ok>Сохранить</button>`}`,
    onMount: (el, close) => {
      const ok = el.querySelector("[data-ok]"); if (ok) ok.onclick = async () => {
        const v = formData(el); if (!v.date || !v.from || !v.to || v.to <= v.from) return toast("Проверьте дату и время", true);
        const row = { title: v.title || "Встреча", person_id: v.person_id || null, client_name: v.client_name, contact: v.contact, link: v.link, note: v.note, start_at: new Date(`${v.date}T${v.from}:00`).toISOString(), end_at: new Date(`${v.date}T${v.to}:00`).toISOString(), ...(m.id ? { status: v.status } : {}) };
        const r = m.id ? await sb.from("meetings").update(row).eq("id", m.id) : await sb.from("meetings").insert(row);
        if (r.error) return toast(r.error.message, true); close(); toast("Сохранено"); done();
      };
      const del = el.querySelector("[data-del]"); if (del) del.onclick = () => { close(); delRec({ table: "meetings", id: m.id, what: `встречу «${m.client_name || m.title}»`, done }); };
      const dl = el.querySelector("[data-deal]"); if (dl) dl.onclick = async (e) => { e.preventDefault(); close(); const { dealCard } = await import("./crm.js?v=15"); const r = await sb.from("deals").select("*").eq("id", m.deal_id).single(); if (r.data) dealCard(r.data, done); };
    },
  });
}

/* ---------- занятость ---------- */
function busyForm(b, done) {
  const mine = b.person_id === S.profile.person_id, other = can("calendar", "edit");
  modal({
    title: b.id ? "Занятость" : "Когда я не могу",
    body: `<p class="small muted" style="margin:0">В это время клиенты не смогут записаться к ${mine ? "вам" : "этому человеку"}. Если свободен кто-то другой из принимающих — запись будет к нему.</p>
      ${other ? field("Кто", "person_id", b.person_id, { options: S.people.filter((p) => p.active !== false).map((p) => [p.id, p.name]) }) : ""}
      <div class="seg" data-kind><button type="button" data-k="once" class="${b.kind !== "weekly" ? "on" : ""}">Один раз</button><button type="button" data-k="weekly" class="${b.kind === "weekly" ? "on" : ""}">Каждую неделю</button></div>
      <div class="grid3"><div data-once>${field("Дата", "date", b.date, { type: "date" })}</div><div data-weekly>${field("День недели", "weekday", b.weekday || ((new Date(b.date + "T12:00:00").getDay() + 6) % 7) + 1, { options: WD.map((x, i) => [i + 1, ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"][i]]) })}</div>${field("С", "from", b.from, { type: "time" })}${field("До", "to", b.to, { type: "time" })}</div>
      ${field("Причина (видна коллегам)", "note", b.note, { ph: "Обед, другая встреча, дорога…" })}`,
    footer: `${b.id && (mine || can("calendar", "delete")) ? `<button class="btn danger" data-del>Удалить</button>` : ""}<button class="btn" data-close>Отмена</button>${b.id && !mine && !other ? "" : `<button class="btn primary" data-ok>Сохранить</button>`}`,
    onMount: (el, close) => {
      let kind = b.kind === "weekly" ? "weekly" : "once";
      const sync = () => { el.querySelector("[data-once]").style.display = kind === "once" ? "" : "none"; el.querySelector("[data-weekly]").style.display = kind === "weekly" ? "" : "none"; $$("[data-k]", el).forEach((x) => x.classList.toggle("on", x.dataset.k === kind)); };
      $$("[data-k]", el).forEach((x) => (x.onclick = () => { kind = x.dataset.k; sync(); })); sync();
      const ok = el.querySelector("[data-ok]"); if (ok) ok.onclick = async () => {
        const v = formData(el); if (!v.from || !v.to || v.to <= v.from) return toast("Проверьте время", true);
        const row = kind === "once" ? { kind, start_at: new Date(`${v.date}T${v.from}:00`).toISOString(), end_at: new Date(`${v.date}T${v.to}:00`).toISOString(), weekday: null, t_from: null, t_to: null } : { kind, weekday: +v.weekday, t_from: v.from, t_to: v.to, start_at: null, end_at: null };
        row.note = v.note || ""; row.person_id = v.person_id || b.person_id;
        const r = b.id ? await sb.from("busy").update(row).eq("id", b.id) : await sb.from("busy").insert(row);
        if (r.error) return toast(r.error.message, true); close(); toast("Сохранено"); done();
      };
      const del = el.querySelector("[data-del]"); if (del) del.onclick = () => { close(); delRec({ table: "busy", id: b.id, what: "эту занятость", done }); };
    },
  });
}

/* ---------- настройки записи ---------- */
function settingsForm(done) {
  const C = cfg(), own = isOwnerP();
  modal({
    title: "Настройки записи на встречи",
    body: `<div class="grid3">${field("Записываться с", "from", C.from, { type: "time" })}${field("до", "to", C.to, { type: "time" })}${field("Длительность встречи, мин", "dur", C.dur, { type: "number" })}</div>
      <div class="grid3">${field("Перерыв между встречами, мин", "gap", C.gap, { type: "number" })}${field("Запись вперёд, дней", "days", C.days, { type: "number" })}${field("Не раньше чем через, ч", "notice", C.notice, { type: "number" })}</div>
      ${field("Постоянная ссылка на встречу (Zoom, Телемост)", "link", C.link, { ph: "https://telemost.yandex.ru/j/…", hint: "Клиент увидит её сразу после записи" })}
      <div><div class="sec-t">Кто принимает заявки и проводит встречи</div><div class="stack" style="gap:6px">${S.people.filter((p) => p.active !== false).map((p) => `<label class="chk"><input type="checkbox" data-tl="${p.id}"${p.takes_leads ? " checked" : ""}${own ? "" : " disabled"}> ${esc(p.name)}</label>`).join("")}</div>
        <div class="small muted" style="margin-top:6px">Им приходят новые заявки и встречи в Telegram, кто первый нажал «Взять» — того и встреча. Клиенту доступно время, когда свободен хотя бы один из них.</div></div>`,
    footer: own ? `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button>` : `<span class="small muted">Менять настройки может владелец</span>`,
    onMount: (el, close) => {
      const ok = el.querySelector("[data-ok]"); if (!ok) return;
      ok.onclick = async (e) => {
        const v = formData(el); if (!v.from || !v.to || v.to <= v.from) return toast("Проверьте часы записи", true);
        busy(e.target, true, "Сохраняю…");
        try {
          const o = { ...(S.settings.options || {}), calendar: { from: v.from, to: v.to, dur: Math.max(15, v.dur || 60), gap: Math.max(0, v.gap ?? 15), days: Math.max(1, v.days || 14), notice: Math.max(0, v.notice ?? 3), link: v.link || "" } };
          check(await sb.from("settings").update({ options: o }).eq("id", 1));
          for (const cb of $$("[data-tl]", el)) { const p = S.people.find((x) => x.id === cb.dataset.tl); if (!!p.takes_leads !== cb.checked) check(await sb.from("people").update({ takes_leads: cb.checked }).eq("id", p.id)); }
          await loadRefs(); close(); toast("Настройки сохранены"); done();
        } catch (err) { toast(err.message, true); busy(e.target, false); }
      };
    },
  });
}

/* ---------- Telegram ---------- */
export async function telegramDialog() {
  const me = S.profile.person_id;
  if (!me) return toast("Ваш вход не связан с человеком в «Настройки → Люди»", true);
  const { data: link } = await sb.from("tg_links").select("*").eq("person_id", me).maybeSingle();
  const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
  modal({
    title: "Telegram-бот Tropos",
    body: link ? `<div class="note info">Подключено${link.username ? ` к @${esc(link.username)}` : ""} с ${d(iso(new Date(link.linked_at)))}.</div><p class="small" style="margin:0">Бот присылает новые задачи, заявки и встречи, по будням в 8:00 — сводку. В задаче: «✅ Выполнено», отчёт, файлы, перенос на завтра.</p>`
      : `<p style="margin:0">Бот @${BOT} будет присылать ваши задачи, новые заявки и встречи. В нём можно отмечать задачи выполненными, писать отчёты и отправлять файлы.</p><ol class="small" style="margin:0;padding-left:20px"><li>Нажмите «Подключить» — откроется Telegram.</li><li>В чате с ботом нажмите «Старт».</li></ol><div class="small muted">Ссылка одноразовая и действует сутки.</div>`,
    footer: link ? `<button class="btn danger" data-off>Отключить</button><a class="btn primary" href="https://t.me/${BOT}" target="_blank" rel="noopener">Открыть бота</a>` : `<button class="btn" data-close>Позже</button><button class="btn primary" data-on>Подключить</button>`,
    onMount: (el, close) => {
      const on = el.querySelector("[data-on]"); if (on) on.onclick = async () => {
        const r = await sb.from("tg_codes").insert({ code, person_id: me }); if (r.error) return toast(r.error.message, true);
        window.open(`https://t.me/${BOT}?start=${code}`, "_blank", "noopener"); close(); toast("Нажмите «Старт» в Telegram");
      };
      const off = el.querySelector("[data-off]"); if (off) off.onclick = async () => { await sb.from("tg_links").delete().eq("person_id", me); close(); toast("Telegram отключён"); };
    },
  });
}
