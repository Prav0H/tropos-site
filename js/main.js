// Вход, каркас и переходы между разделами.
import { sb, S, loadRefs, isOwner } from "./db.js?v=15";
import { esc, toast } from "./ui.js?v=15";
import * as V from "./views.js?v=15";
import * as CRM from "./crm.js?v=15";
import { tasksPage } from "./tasks.js?v=15";
import { projectsList, projectPage } from "./projects.js?v=15";
import { offerNew } from "./offers.js?v=15";
import { financePage } from "./finance.js?v=15";
import { orgPage } from "./org.js?v=15";
import { calendarPage, telegramDialog } from "./cal.js?v=15";
import { dashboard } from "./dash.js?v=15";
import { pinLogin, linkLogin, profilePage } from "./me.js?v=15";
import { can, NAV_RES, applyUi, watchUi, myRole } from "./access.js?v=15";

export const APP_VERSION = "1.0.0";
const app = document.getElementById("app");

const NAV = [
  ["dashboard", "Главная", "#/"],
  ["tasks", "Задачи", "#/tasks"],
  ["deals", "Продажи", "#/deals"],
  ["calendar", "Календарь", "#/calendar"],
  ["clients", "Клиенты", "#/clients"],
  ["projects", "Проекты", "#/projects"],
  ["contracts", "Документация", "#/contracts"],
  ["finance", "Финансы", "#/finance"],
  ["dev", "Развитие", "#/dev"],
  ["analytics", "Аналитика", "#/analytics"],
  ["org", "Оргсхема", "#/org"],
  ["requests", "Запросы в ВС", "#/requests"],
  ["sep"],
  ["settings", "Настройки", "#/settings"],
];
// что видно в меню: «Договоры» — если доступна хоть одна их вкладка, «Настройки» — настройки или прайс
// значки меню (контурные, 24×24)
const ICONS = {
  dashboard: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  tasks: '<path d="m8 11 3 3 9-9"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10"/>',
  deals: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  contracts: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  projects: '<rect x="3" y="4" width="10" height="4" rx="1.5"/><rect x="8" y="10" width="13" height="4" rx="1.5"/><rect x="5" y="16" width="9" height="4" rx="1.5"/>',
  finance: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r=".8"/>',
  dev: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  analytics: '<path d="M5 20V10M11 20V4M17 20v-7M2 20h20"/>',
  requests: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3v3H8z"/>',
  org: '<rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="2.5" y="16" width="6" height="5" rx="1.2"/><rect x="15.5" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M5.5 16v-4h13v4"/>',
  settings: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="18" r="2.2"/>',
};
const navSee = (k) => (k === "contracts" ? ["contracts", "offers", "docs"].some((r) => can(r, "see")) : k === "settings" ? can("settings", "see") || can("price", "see") || can("finance", "edit") : can(NAV_RES[k], "see"));
const HUB_TAB = { offers: "offers", list: "contracts", invoices: "docs", acts: "docs" };
const MOVED = { invoices: "#/contracts/invoices", acts: "#/contracts/acts", payouts: "#/finance/salary", price: "#/settings/price", catalog: "#/settings/price" };

function loginView(msg = "") { return pinLogin(app, start, (m) => mailLogin(m || msg), msg); }
function mailLogin(msg = "") {
  app.innerHTML = `<div class="login"><form class="box" id="lf">
    <div class="logo">tropos <span class="pill"></span></div>
    <div class="bar"></div>
    <h2>Вход</h2>
    <label class="f">Почта<input name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
    <label class="f">Пароль<span class="pw"><input name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required><button type="button" class="pw-eye" aria-label="Показать пароль">👁</button></span></label>
    ${msg ? `<div class="note">${esc(msg)}</div>` : ""}
    <button class="btn primary" type="submit">Войти</button>
    <span class="small muted">Доступ выдаёт владелец. Забыли пароль — напишите Левону.</span><button type="button" class="btn ghost sm" id="byPin">← Войти по коду</button>
  </form></div>`;
  const bp = document.getElementById("byPin"); if (bp) bp.onclick = () => loginView();
  const eye = document.querySelector(".pw-eye"); if (eye) eye.onclick = () => { const i = document.querySelector("#lf [name=password]"); i.type = i.type === "password" ? "text" : "password"; };
  document.getElementById("lf").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button");
    btn.disabled = true; btn.textContent = "Вхожу…";
    const email = f.email.value.trim().toLowerCase(), password = f.password.value.replace(/\s+$/, "");
    let error;
    try { ({ error } = await sb.auth.signInWithPassword({ email, password })); } catch (err) { error = err; }
    if (error) {
      const m = String(error.message || error);
      loginView(/invalid login|credentials/i.test(m) ? "Неверная почта или пароль. Проверьте раскладку клавиатуры." : /fetch|network|load failed/i.test(m) ? "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." : /confirm/i.test(m) ? "Почта не подтверждена — напишите Левону." : "Не удалось войти: " + m);
      const fe = document.querySelector("#lf [name=email]"); if (fe) fe.value = email;
    } else start();
  };
}

function shell() {
  const nav = NAV.filter((n) => n[0] === "sep" || navSee(n[0])).filter((n, i, a) => !(n[0] === "sep" && (i === 0 || i === a.length - 1 || a[i - 1][0] === "sep")));
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="logo">tropos <span class="pill"></span></div>
      ${nav.map(([k, l, h]) => (k === "sep" ? `<div class="nav-sep"></div>` : `<a class="nav" data-k="${k}" href="${h}"><svg class="ni" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ""}</svg>${l}</a>`)).join("")}
      <div class="sp"></div>
      <div class="me"><a href="#/me" class="me-link"><b>${esc(S.profile.name)}</b> · ${isOwner() ? "владелец" : esc((myRole() || {}).name || "сотрудник")}</a><br><a href="#/me" class="me-sm">Профиль</a> · <button id="tgcon">Telegram</button> · <button id="logout">Выйти</button></div>
    </aside>
    <main id="main"></main>
  </div>`;
  document.getElementById("tgcon").onclick = telegramDialog;
  document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); location.hash = "#/"; loginView(); };
}

let routeN = 0;
async function route() {
  const main = document.getElementById("main");
  if (!main) return;
  const h = location.hash.replace(/^#\/?/, "");
  const [sec = "", id = "", sub = "", sub2 = ""] = h.split("/");
  const key = sec || "dashboard";
  // старые адреса разделов, которые переехали во вкладки
  if (MOVED[key] || (key === "offers" && id !== "new")) return location.replace(MOVED[key] || "#/contracts/offers");
  // «Документация»: КП, договоры, счета, акты; без вкладки в адресе — первая доступная
  const hubTab = key !== "contracts" ? "" : HUB_TAB[id] ? id : !id ? ["offers", "list", "invoices"].find((t) => can(HUB_TAB[t], "see")) || "offers" : "";
  const navKey = key === "pipelines" ? "deals" : key === "offers" ? "contracts" : key;
  // раздел прав: вкладка «Договоров» — свой, вкладка «Прайс» в настройках — свой
  const res = hubTab ? HUB_TAB[hubTab] : key === "settings" && id === "finance" ? "finance" : key === "settings" && (id === "price" || !can("settings", "see")) ? (can("price", "see") || id === "price" ? "price" : "finance") : NAV_RES[key];
  document.querySelectorAll(".side a.nav").forEach((a) => a.classList.toggle("on", a.dataset.k === navKey));
  const my = ++routeN; // если пока грузится раздел, человек ушёл в другой — старый не рисуем поверх
  const box = document.createElement("div"); box.innerHTML = `<div class="boot">Загрузка…</div>`;
  main.replaceChildren(box);
  if (res && !can(res, "see")) { box.innerHTML = `<div class="empty">Нет доступа к разделу. Права выдаёт владелец в «Настройки → Должности и права».</div>`; return; }
  applyUi(res);
  try {
    if (key === "dashboard") await dashboard(box);
    else if (key === "clients") id ? await V.clientCard(box, id) : await V.clients(box);
    else if (key === "contracts") id === "new" ? await V.wizard(box, sub) : id && !hubTab ? await V.contractCard(box, id) : await V.contractsHub(box, hubTab);
    else if (key === "finance") await financePage(box, id);
    else if (key === "requests") await V.requests(box);
    else if (key === "org") await orgPage(box);
    else if (key === "me") await profilePage(box);
    else if (key === "calendar") await calendarPage(box, id);
    else if (key === "deals") await CRM.dealsPage(box, id);
    else if (key === "pipelines") await CRM.pipelinesSettings(box);
    else if (key === "analytics") await CRM.analytics(box);
    else if (key === "tasks") await tasksPage(box, id || "all");
    else if (key === "projects") id ? await projectPage(box, id, sub || "schedule", sub2) : await projectsList(box, "client");
    else if (key === "dev") id ? await projectPage(box, id, sub || "schedule", sub2) : await projectsList(box, "dev");
    else if (key === "offers") await offerNew(box, sub);
    else if (key === "settings") await V.settings(box, id || "company");
    else box.innerHTML = `<div class="empty">Раздел не найден</div>`;
  } catch (e) {
    console.error(e);
    if (my === routeN) box.innerHTML = `<div class="empty">Не удалось загрузить раздел: ${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">Обновить страницу</button></div>`;
  }
  if (my === routeN) window.scrollTo(0, 0);
}

async function start() {
  window.__booted = true; clearTimeout(window.__bootTimer);
  if (location.hash.startsWith("#/k/")) await linkLogin();
  const { data } = await sb.auth.getSession();
  if (!data.session) return loginView();
  S.user = data.session.user;
  try { await loadRefs(); } catch (e) { return loginView("Ошибка загрузки: " + e.message); }
  if (!S.profile) { await sb.auth.signOut(); return loginView("У этой учётной записи нет доступа. Обратитесь к владельцу."); }
  shell();
  watchUi();
  route();
}

window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (e) => toast((e.reason && e.reason.message) || "Ошибка", true));
start();
