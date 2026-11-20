// Вход по 4-значному коду и личной ссылке; «Профиль» — код, Telegram, уведомления, ссылки для входа. Доступен всем.
import { sb, S, SB_URL, check, loadRefs } from "./db.js?v=15";
import { esc, d, $, $$, toast, modal, field, formData, busy, confirmBox } from "./ui.js?v=15";
import { iso } from "./calendar.js?v=15";
import { telegramDialog } from "./cal.js?v=15";

const FN = SB_URL + "/functions/v1/tg";
const BASE = location.origin + location.pathname;
async function call(body) {
  const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok || j.error) throw new Error(j.error || "Сервер не ответил, попробуйте ещё раз");
  return j;
}
async function enter(token_hash) {
  const { error } = await sb.auth.verifyOtp({ token_hash, type: "magiclink" });
  if (error) throw new Error(error.message);
}
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("tr_" + k); localStorage.setItem("tr_" + k, v); } catch (e) { return null; } };

/** Вход по личной ссылке: адрес вида …/#/k/<ключ>. Возвращает true, если вошли. */
export async function linkLogin() {
  const m = location.hash.match(/^#\/k\/([A-Za-z0-9_-]{20,})/);
  if (!m) return false;
  history.replaceState(null, "", BASE + "#/");
  try { const j = await call({ login: "link", token: m[1] }); await enter(j.token_hash); return true; }
  catch (e) { toast(e.message, true); return false; }
}

/** Экран входа: выбрать себя и набрать код. Почта и пароль — запасной вариант. */
export async function pinLogin(app, onDone, fallback, msg = "") {
  app.innerHTML = `<div class="login"><div class="box pinbox"><div class="logo">tropos <span class="pill"></span></div><div class="bar"></div><div id="pb"><div class="boot">Загрузка…</div></div>
    <button class="btn ghost sm" id="byMail" style="align-self:center">Войти по почте и паролю</button></div></div>`;
  $("#byMail", app).onclick = () => fallback();
  let people = [];
  try { people = JSON.parse(pref("people") || "[]"); } catch (e) { people = []; }
  const fresh = call({ login: "people" }).then((j) => { pref("people", JSON.stringify(j.people || [])); return j.people || []; });
  if (!people.length) { try { people = await fresh; } catch (e) { return fallback(e.message); } } else fresh.catch(() => {});
  if (!people.length) return fallback(msg);
  const pb = $("#pb", app);
  const chooser = (err = msg) => {
    pb.innerHTML = `<h2>Кто входит?</h2>${err ? `<div class="note">${esc(err)}</div>` : ""}<div class="pin-people">${people.map((p) => `<button data-p="${p.id}"><span class="tk-ava">${esc(p.name.split(" ").map((x) => x[0]).join("").slice(0, 2))}</span>${esc(p.name)}</button>`).join("")}</div>`;
    $$("[data-p]", pb).forEach((b) => (b.onclick = () => keypad(people.find((p) => p.id === b.dataset.p))));
  };
  const keypad = (p, err = "") => {
    pref("last_person", p.id);
    let code = "";
    pb.innerHTML = `<button class="btn ghost sm pin-back">← ${people.length > 1 ? "Другой человек" : "Назад"}</button><h2>${esc(p.name)}</h2><div class="small muted">Введите код из 4 цифр</div>
      <div class="pin-dots">${"<i></i>".repeat(4)}</div><div class="pin-err">${esc(err)}</div>
      <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((k) => k === "" ? "<span></span>" : `<button data-k="${k}">${k}</button>`).join("")}</div>`;
    $(".pin-back", pb).onclick = () => chooser("");
    const dots = () => $$(".pin-dots i", pb).forEach((x, i) => x.classList.toggle("on", i < code.length));
    const go = async () => {
      pb.classList.add("busy");
      try { const j = await call({ login: "pin", person_id: p.id, pin: code }); await enter(j.token_hash); onDone(); }
      catch (e) { pb.classList.remove("busy"); keypad(p, e.message); $(".pin-dots", pb).classList.add("shake"); }
    };
    const press = (k) => { if (pb.classList.contains("busy")) return; if (k === "⌫") code = code.slice(0, -1); else if (code.length < 4) code += k; dots(); if (code.length === 4) go(); };
    $$("[data-k]", pb).forEach((b) => (b.onclick = () => press(b.dataset.k)));
    document.onkeydown = (e) => { if (!$(".pin-pad", pb)) return (document.onkeydown = null); if (/^[0-9]$/.test(e.key)) press(e.key); if (e.key === "Backspace") press("⌫"); };
  };
  const last = people.find((p) => p.id === pref("last_person"));
  if (people.length === 1) keypad(people[0], msg); else if (last && !msg) keypad(last); else chooser();
}

/* ====================== Профиль ====================== */
const NOTIFY = [["task", "Новая задача мне", "Когда вам ставят задачу"], ["done", "Мою задачу выполнили", "Когда исполнитель отметил выполненной задачу, которую поставили вы"], ["lead", "Новые заявки", "С кнопкой «Взять в работу» — если вы принимаете заявки"], ["meeting", "Новые встречи", "Клиент записался или вам назначили встречу"], ["remind", "Напоминание о встрече", "За 30 минут до начала"], ["digest", "Утренняя сводка", "По будням в 8:00: встречи и задачи на день"]];
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");

export async function profilePage(main) {
  await loadRefs();
  const me = S.people.find((p) => p.id === S.profile.person_id);
  if (!me) { main.innerHTML = `<div class="empty">Ваш вход не связан с человеком в «Настройки → Люди». Напишите владельцу.</div>`; return; }
  const [pin, links, tg] = await Promise.all([sb.from("pins").select("pin").eq("person_id", me.id).maybeSingle(), sb.from("login_links").select("*").eq("person_id", me.id).order("created_at"), sb.from("tg_links").select("*").eq("person_id", me.id).maybeSingle()]);
  const N = { task: true, done: true, lead: true, meeting: true, remind: true, digest: true, ...(me.notify || {}) };
  const re = () => profilePage(main);
  main.innerHTML = `<div class="page-head"><div><h1>Профиль</h1><div class="small muted" style="margin-top:4px">${esc(me.name)} · вход, уведомления, Telegram</div></div></div>
    <div class="cols"><div class="stack">
      <div class="card"><div class="sec-t">Уведомления в Telegram</div>
        ${tg.data ? "" : `<div class="note" style="margin-bottom:10px">Telegram не подключён — уведомлений не будет. <button class="btn sm" id="tgc">Подключить</button></div>`}
        <div class="stack" style="gap:10px">${NOTIFY.map(([k, l, h]) => `<label class="ntf"><input type="checkbox" data-n="${k}"${N[k] !== false ? " checked" : ""}><span class="wsw-i"></span><span><b>${l}</b><small>${h}</small></span></label>`).join("")}</div>
        <div class="small muted" style="margin-top:10px">Сохраняется сразу. То же можно менять в боте: кнопка «⚙ Уведомления».</div></div>
      <div class="card"><div class="row between"><div class="sec-t" style="margin:0">Личные ссылки для входа</div><button class="btn sm" id="nl">+ Ссылка</button></div>
        <p class="small muted">Открываете ссылку на телефоне или компьютере — и вы в программе без кода. Ссылка — как ключ: не пересылайте её. Если потеряли телефон — отзовите.</p>
        ${links.data && links.data.length ? `<div class="tw"><table class="t">${links.data.map((l) => `<tr><td><b>${esc(l.label || "Ссылка")}</b><div class="small muted">создана ${d(iso(new Date(l.created_at)))}${l.last_used ? ` · вход ${new Date(l.last_used).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : " · ещё не входили"}</div></td><td class="n"><button class="btn sm ghost danger" data-lr="${l.id}">Отозвать</button></td></tr>`).join("")}</table></div>` : `<div class="muted small">Ссылок нет</div>`}</div>
    </div><div class="stack">
      <div class="card"><div class="sec-t">Код для входа</div>
        <div class="pin-show">${pin.data ? `<b data-pin>••••</b><button class="btn sm ghost" id="sp">Показать</button>` : `<span class="muted">не задан</span>`}</div>
        <div class="row" style="margin-top:10px"><input id="np" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="Новый код" style="width:130px;letter-spacing:.3em;text-align:center"><button class="btn primary" id="sv">Сменить код</button></div>
        <div class="small muted" style="margin-top:8px">4 цифры. После 5 ошибок подряд вход по коду закрывается на 15 минут.</div></div>
      <div class="card"><div class="sec-t">Telegram</div>${tg.data ? `<div>Подключён${tg.data.username ? ` к @${esc(tg.data.username)}` : ""}</div>` : `<div class="muted">Не подключён</div>`}<button class="btn sm" id="tgc2" style="margin-top:8px">${tg.data ? "Настроить" : "Подключить"}</button></div>
      <div class="card"><div class="sec-t">Приложение на телефоне</div><p class="small" style="margin:0">iPhone: откройте Tropos в Safari → кнопка «Поделиться» → «На экран „Домой“». Войдите в приложении один раз — дальше оно помнит вход.</p></div>
    </div></div>`;
  $$("[data-n]", main).forEach((cb) => (cb.onchange = async () => { const r = await sb.rpc("set_my_notify", { p: { [cb.dataset.n]: cb.checked } }); if (r.error) return toast(r.error.message, true); toast(cb.checked ? "Включено" : "Выключено"); await loadRefs(); }));
  ["#tgc", "#tgc2"].forEach((s) => { const b = $(s, main); if (b) b.onclick = telegramDialog; });
  const sp = $("#sp", main); if (sp) sp.onclick = () => { const b = $("[data-pin]", main); const open = b.textContent !== "••••"; b.textContent = open ? "••••" : pin.data.pin; sp.textContent = open ? "Показать" : "Скрыть"; };
  $("#sv", main).onclick = async (e) => {
    const v = $("#np", main).value.trim(); if (!/^\d{4}$/.test(v)) return toast("Нужно ровно 4 цифры", true);
    if (/^(\d)\1{3}$/.test(v) || "0123456789".includes(v) || "9876543210".includes(v)) return toast("Слишком простой код (1111, 1234…) — придумайте другой", true);
    busy(e.target, true, "…"); const r = await sb.from("pins").upsert({ person_id: me.id, pin: v, failed: 0, locked_until: null, updated_at: new Date().toISOString() }); busy(e.target, false);
    if (r.error) return toast(r.error.message, true); toast("Код изменён"); re();
  };
  $("#nl", main).onclick = () => modal({
    title: "Новая ссылка для входа", body: field("Для какого устройства", "label", "", { ph: "Мой iPhone" }),
    footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Создать</button>`,
    onMount: (el, close) => (el.querySelector("[data-ok]").onclick = async () => {
      const label = formData(el).label || "Ссылка", tok = randomToken();
      const r = await sb.from("login_links").insert({ person_id: me.id, token_hash: await sha(tok), label }); if (r.error) return toast(r.error.message, true);
      close(); const url = `${BASE}#/k/${tok}`;
      modal({ title: "Ссылка готова", body: `<p class="small" style="margin:0">Откройте её на нужном устройстве — и сохраните в закладки или на экран «Домой». <b>Ссылка показывается один раз.</b></p><textarea rows="3" readonly id="lk">${esc(url)}</textarea>`,
        footer: `<button class="btn primary" data-cp>Скопировать</button>`,
        onMount: (e2, c2) => (e2.querySelector("[data-cp]").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Скопировано"); c2(); re(); } catch (er) { e2.querySelector("#lk").select(); toast("Выделено — нажмите Ctrl+C"); } }) });
      re();
    }),
  });
  $$("[data-lr]", main).forEach((b) => (b.onclick = async () => { if (!(await confirmBox("Отозвать ссылку? По ней больше нельзя будет войти.", "Отозвать"))) return; const r = await sb.from("login_links").delete().eq("id", b.dataset.lr); if (r.error) return toast(r.error.message, true); toast("Ссылка отозвана"); re(); }));
}
