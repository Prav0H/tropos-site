// Удаление любой записи: подтверждение, файлы из хранилища, понятные ошибки.
// Право «Удаление» по разделу проверяется и здесь (кнопка), и в базе (sql/07_delete_org.sql).
import { sb } from "./db.js?v=15";
import { esc, toast, confirmBox } from "./ui.js?v=15";
import { can } from "./access.js?v=15";

/** Кнопка-корзина. res — раздел прав; без права «Удаление» кнопки нет. */
export const delBtn = (res, attrs, label = "") => (can(res, "delete") ? `<button type="button" class="btn sm ghost danger del-b" ${attrs} title="Удалить" aria-label="Удалить">🗑${label ? " " + esc(label) : ""}</button>` : "");
/** Большая кнопка «Удалить» для шапки карточки. */
export const delHead = (res, id = "delrec") => (can(res, "delete") ? `<button type="button" class="btn danger" id="${id}">Удалить</button>` : "");

const NO_RIGHT = "Нет права на удаление. Его выдаёт владелец: «Настройки → Должности и права».";
const FK = "Запись нельзя удалить: на неё ссылаются другие данные.";

/**
 * @param o { table, id, what — «сделку „Х“», warn — что ещё удалится, files — пути в хранилище, before() — подготовка, done() }
 * @returns true, если удалено
 */
export async function delRec(o) {
  if (!(await confirmBox(`Удалить ${o.what}?${o.warn ? " " + o.warn : ""} Вернуть будет нельзя.`, "Удалить"))) return false;
  try {
    if (o.before) await o.before();
    const r = await sb.from(o.table).delete().eq("id", o.id).select("id");
    if (r.error) { toast(/foreign key|violates/i.test(r.error.message) ? `${FK} ${o.fkHint || ""}` : /policy|permission/i.test(r.error.message) ? NO_RIGHT : r.error.message, true); return false; }
    if (!r.data || !r.data.length) { toast(NO_RIGHT, true); return false; }
    const files = (o.files || []).filter(Boolean);
    if (files.length) await sb.storage.from("docs").remove(files);
    toast("Удалено");
    if (o.done) await o.done();
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
/** Все пути файлов в объекте files ({pdf, docx, scan, ...}). */
export const filePaths = (f) => Object.entries(f || {}).filter(([k, v]) => k !== "name" && typeof v === "string" && v.includes("/")).map(([, v]) => v);
