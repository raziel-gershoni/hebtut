/**
 * Cross-surface strings + small linguistic helpers. Anything that's both
 * user-visible AND not tied to a specific surface lives here.
 *
 * `pluralDay` consolidates the Russian "день / дня / дней" rule that used
 * to be inlined into three separate copy keys in the old i18n.ts.
 */

export const common = {
  save: "Сохранить",
  cancel: "Отмена",
  close: "Закрыть",
  delete: "Удалить",
  remove: "Удалить",
  retry: "Попробовать ещё раз",
  confirm: "Подтвердить",
  open: "Открыть",
  saving: "Сохраняем…",
  loading: "Загружаем…",
  errorGeneric: "Не получилось — попробуй ещё раз.",
};

/**
 * Russian declension for "день" — masculine singular / paucal / genitive
 * plural. Pure: `pluralDay(1)` → "день", `pluralDay(2)` → "дня",
 * `pluralDay(5)` → "дней", `pluralDay(21)` → "день", `pluralDay(12)` →
 * "дней". Numbers with 100-anchor in [11..14] always take "дней".
 */
export function pluralDay(n: number): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return "дней";
  if (n10 === 1) return "день";
  if (n10 >= 2 && n10 <= 4) return "дня";
  return "дней";
}

/**
 * Companion to `pluralDay` for cases where the verb's number must agree
 * with the day count: "1 день остался" vs "5 дней осталось". True only
 * when the masculine-singular form is used (n10 === 1, n100 !== 11).
 */
export function isSingularDay(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11;
}

/**
 * Russian "связь / связи / связей" — used by the admin connections panel.
 * Same Slavic rule as `pluralDay` applied to a feminine noun.
 */
export function pluralLink(n: number): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return "связей";
  if (n10 === 1) return "связь";
  if (n10 >= 2 && n10 <= 4) return "связи";
  return "связей";
}
