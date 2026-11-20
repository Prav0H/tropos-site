// Права доступа по должностям — по образцу «Включи систему» (RoleResourceEnum):
// раздел → набор галочек, у каждой галочки «implies» (включает нужные ей). Владелец видит всё.
// Финансы и выплаты дополнительно закрыты на уровне базы (функция has_perm в sql/05_finance.sql).
import { S } from "./db.js?v=15";

const W = (t = "Просмотр") => ({ key: "watch", title: t });
const OWN = (t) => ({ key: "watchOwn", title: t });
const ALL = (t, im = ["watchOwn"]) => ({ key: "watchAll", title: t, implies: im });
const CR = (im, t = "Создание") => ({ key: "create", title: t, implies: im });
const ED = (im, t = "Редактирование") => ({ key: "edit", title: t, implies: im });
const DL = (t = "Удаление") => ({ key: "delete", title: t, implies: ["edit"] });

export const RESOURCES = [
  { group: "Работа", key: "dashboard", title: "Главная", desc: "Рабочий стол: задачи на сегодня, счета, план продаж.", perms: [W(), { key: "money", title: "Видеть деньги", implies: ["watch"] }] },
  { group: "Работа", key: "tasks", title: "Задачи", desc: "Задачник: канбан, Эйзенхауэр, список, календарь.", perms: [OWN("Свои задачи"), ALL("Все задачи"), CR(["watchOwn"]), ED(["watchOwn"]), DL()] },
  { group: "Работа", key: "deals", title: "Продажи", desc: "Воронки и карточки сделок.", perms: [OWN("Свои сделки"), ALL("Все сделки"), CR(["watchOwn"]), ED(["watchOwn"]), DL()] },
  { group: "Работа", key: "calendar", title: "Календарь", desc: "Встречи с клиентами и занятость сотрудников.", perms: [W(), CR(["watch"]), ED(["watch"], "Редактирование и настройки"), DL()] },
  { group: "Работа", key: "clients", title: "Клиенты", desc: "Карточки клиентов и реквизиты.", perms: [W(), CR(["watch"]), ED(["watch"]), DL()] },
  { group: "Работа", key: "projects", title: "Проекты", desc: "Клиентские проекты: план и выполнение работ, приёмка, задачи, финансы, файлы.", perms: [OWN("Свои проекты"), ALL("Все проекты"), CR(["watchOwn"]), ED(["watchOwn"]), DL()] },
  { group: "Документация", key: "contracts", title: "Договоры", desc: "Договоры, платежи, начисления (вкладка в «Документации»).", perms: [W(), CR(["watch"]), ED(["watch"]), DL()] },
  { group: "Документация", key: "offers", title: "КП", desc: "Коммерческие предложения (первая вкладка «Документации»).", perms: [W(), CR(["watch"]), DL()] },
  { group: "Документация", key: "docs", title: "Счета и акты", desc: "Счета и акты (вкладки в «Документации»).", perms: [W(), CR(["watch"]), { key: "delete", title: "Удаление", implies: ["watch"] }] },
  { group: "Компания", key: "finance", title: "Финансы", desc: "Деньги компании, платёжный календарь, бюджет, зарплата; счета и статьи — в настройках.", perms: [OWN("Своя зарплата"), ALL("Финансы компании"), ED(["watchAll"], "Вносить операции и выплаты"), DL()] },
  { group: "Компания", key: "dev", title: "Развитие", desc: "Внутренние направления развития.", perms: [W(), CR(["watch"]), ED(["watch"]), DL()] },
  { group: "Компания", key: "analytics", title: "Аналитика", desc: "План и факт продаж.", perms: [W()] },
  { group: "Компания", key: "requests", title: "Запросы в ВС", desc: "Запросы на доработку «Включи систему» по модулям.", perms: [W(), CR(["watch"]), { key: "delete", title: "Удаление", implies: ["watch"] }] },
  { group: "Настройки", key: "price", title: "Прайс", desc: "Услуги и пакеты (вкладка в настройках).", perms: [W(), ED(["watch"]), DL()] },
  { group: "Компания", key: "org", title: "Оргсхема", desc: "Подразделения, руководители, функции и ответственные.", perms: [W(), ED(["watch"]), DL()] },
  { group: "Настройки", key: "settings", title: "Настройки", desc: "Реквизиты, люди, должности, шаблоны задач, договор.", perms: [W(), ED(["watch"], "Изменение"), DL()] },
];
// адрес раздела → раздел прав
export const NAV_RES = { dashboard: "dashboard", deals: "deals", pipelines: "deals", tasks: "tasks", projects: "projects", dev: "dev", price: "price", catalog: "price", offers: "offers", contracts: "contracts", clients: "clients", invoices: "docs", acts: "docs", analytics: "analytics", org: "org", calendar: "calendar", me: null, finance: "finance", payouts: "finance", requests: "requests", settings: "settings" };

/** Дозаполнить implies до неподвижной точки (как SubscriberRolePermissionsSchema::setData). */
export function closePerms(perms) {
  const out = JSON.parse(JSON.stringify(perms || {}));
  for (const r of RESOURCES) {
    const p = out[r.key] || (out[r.key] = {});
    let ch = true;
    while (ch) { ch = false; for (const d of r.perms) if (p[d.key]) for (const i of d.implies || []) if (!p[i]) { p[i] = true; ch = true; } }
  }
  return out;
}
/** Снять галочку → снять всё, что от неё зависит. */
export function uncheck(perms, res, key) {
  const r = RESOURCES.find((x) => x.key === res), p = perms[res] || {};
  p[key] = false;
  let ch = true;
  while (ch) { ch = false; for (const d of r.perms) if (p[d.key] && (d.implies || []).some((i) => !p[i])) { p[d.key] = false; ch = true; } }
  perms[res] = p;
}

export const isOwnerP = () => S.profile && S.profile.role === "owner";
export function myRole() {
  const me = S.people.find((x) => x.id === (S.profile && S.profile.person_id));
  return me && (S.roles || []).find((r) => r.id === me.role_id);
}
export function can(res, key) {
  if (isOwnerP()) return true;
  const r = myRole();
  if (!r) { // должность не назначена — как раньше: всё, кроме настроек, удаления и финансов компании (там только своя зарплата)
    if (res === "finance") return key === "see" || key === "watchOwn";
    return res !== "settings" && key !== "delete";
  }
  const p = (r.permissions || {})[res] || {};
  if (key === "see") return !!(p.watch || p.watchOwn || p.watchAll);
  return !!p[key];
}
/** Видит только своё (есть «свои», нет «все»). */
export const onlyOwn = (res) => !isOwnerP() && can(res, "watchOwn") && !can(res, "watchAll");

/** После отрисовки раздела: спрятать кнопки создания/удаления, закрыть правку — по правам раздела. */
export function applyUi(res) {
  const R = RESOURCES.find((x) => x.key === res), B = document.body.classList;
  if (!R || isOwnerP()) { B.remove("no-create", "no-delete", "no-edit"); return; }
  const has = (k) => R.perms.some((p) => p.key === k);
  // галочки, которых у раздела нет, ничего не запрещают (на «Главной» кнопка договора — по праву на договоры)
  B.toggle("no-create", has("create") ? !can(res, "create") : res === "dashboard" ? !can("contracts", "create") : false);
  B.toggle("no-delete", has("delete") ? !can(res, "delete") : false);
  B.toggle("no-edit", has("edit") && res !== "finance" ? !can(res, "edit") && !(has("create") && can(res, "create")) : false);
}

let obs = null, queued = false;
function tag(root) {
  queued = false;
  root.querySelectorAll("button:not([data-pt]),a.btn:not([data-pt])").forEach((b) => {
    b.dataset.pt = "1";
    const t = (b.textContent || "").trim();
    if (/^\+/.test(t) || /Новый|Новая|Добавить|Создать/.test(t)) b.dataset.pc = "1";
    if (/Удалить/.test(t) || b.classList.contains("danger") || [...b.attributes].some((a) => /^data-.*del/.test(a.name))) b.dataset.pd = "1";
  });
}
/** Помечать кнопки создания и удаления по мере появления — не чаще раза за кадр. */
export function watchUi() {
  if (obs) return;
  obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => tag(document.body)); } });
  obs.observe(document.body, { childList: true, subtree: true });
  tag(document.body);
}
