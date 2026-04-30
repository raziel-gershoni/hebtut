/**
 * Anonymous handle layer for peer-facing chat surfaces. Maps a stable
 * `tg_user_id` deterministically to:
 *   - handle:  adjective + animal noun (e.g. "Смелый Лев")
 *   - emoji:   the animal emoji (e.g. "🦁")
 *   - bgClass: a Tailwind tinted-background utility for the avatar circle
 *
 * The handle and emoji are *stored* on the user row by the bot at insert
 * time (or lazily backfilled from the admin route); bgClass is presentation
 * only and is computed from the handle string by `bgFromHandle`.
 *
 * Word lists are masculine so Russian declensions stay consistent in the
 * teacher's bot DM copy. 30 × 30 = 900 namespace; collisions are accepted
 * for the PoC (admin can disambiguate via tg_username + tg_user_id).
 */

const ADJECTIVES = [
  "Смелый",
  "Мудрый",
  "Тихий",
  "Быстрый",
  "Добрый",
  "Гордый",
  "Ловкий",
  "Весёлый",
  "Бойкий",
  "Кроткий",
  "Светлый",
  "Ясный",
  "Дерзкий",
  "Скромный",
  "Сильный",
  "Проворный",
  "Осторожный",
  "Упрямый",
  "Гибкий",
  "Зоркий",
  "Звонкий",
  "Стойкий",
  "Хитрый",
  "Ретивый",
  "Шустрый",
  "Лохматый",
  "Вежливый",
  "Тёплый",
  "Резвый",
  "Тучный",
] as const;

const ANIMALS: { readonly noun: string; readonly emoji: string }[] = [
  { noun: "Лев", emoji: "🦁" },
  { noun: "Тигр", emoji: "🐯" },
  { noun: "Волк", emoji: "🐺" },
  { noun: "Медведь", emoji: "🐻" },
  { noun: "Сокол", emoji: "🦅" },
  { noun: "Олень", emoji: "🦌" },
  { noun: "Кит", emoji: "🐳" },
  { noun: "Дельфин", emoji: "🐬" },
  { noun: "Бобр", emoji: "🦫" },
  { noun: "Ёж", emoji: "🦔" },
  { noun: "Енот", emoji: "🦝" },
  { noun: "Барсук", emoji: "🦡" },
  { noun: "Кабан", emoji: "🐗" },
  { noun: "Лось", emoji: "🦌" },
  { noun: "Носорог", emoji: "🦏" },
  { noun: "Гепард", emoji: "🐆" },
  { noun: "Скорпион", emoji: "🦂" },
  { noun: "Ястреб", emoji: "🦅" },
  { noun: "Дятел", emoji: "🐦" },
  { noun: "Морж", emoji: "🐳" },
  { noun: "Краб", emoji: "🦀" },
  { noun: "Слон", emoji: "🐘" },
  { noun: "Конь", emoji: "🐴" },
  { noun: "Пёс", emoji: "🐶" },
  { noun: "Кот", emoji: "🐱" },
  { noun: "Заяц", emoji: "🐰" },
  { noun: "Орёл", emoji: "🦅" },
  { noun: "Жираф", emoji: "🦒" },
  { noun: "Тюлень", emoji: "🦭" },
  { noun: "Хомяк", emoji: "🐹" },
];

const BG_CLASSES = [
  "bg-emerald-500/20",
  "bg-sky-500/20",
  "bg-violet-500/20",
  "bg-rose-500/20",
  "bg-teal-500/20",
  "bg-pink-500/20",
  "bg-indigo-500/20",
];

/** FNV-1a 32-bit. Deterministic, no deps. */
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function userHandle(
  tgUserId: number | string,
): { handle: string; emoji: string; bgClass: string } {
  const h = fnv1a(String(tgUserId));
  const adj = ADJECTIVES[h % ADJECTIVES.length]!;
  const animal = ANIMALS[(h >>> 8) % ANIMALS.length]!;
  const bgClass = BG_CLASSES[(h >>> 16) % BG_CLASSES.length]!;
  return { handle: `${adj} ${animal.noun}`, emoji: animal.emoji, bgClass };
}

/** Presentation-only: derive a tinted bg class from a stored handle string. */
export function bgFromHandle(handle: string): string {
  const h = fnv1a(handle);
  return BG_CLASSES[h % BG_CLASSES.length]!;
}
