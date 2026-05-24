/**
 * Admin-panel Mini App copy. Populated per surface — `users`, `subscription`,
 * `connections`, `settings`, `onboardingVideos`, `tags`, `audit`, `invites`,
 * `bannedUsers`, `version`, `feedback`.
 *
 * New strings always go in the matching sub-group — never inline in the
 * component. See CLAUDE.md.
 */

const settings = {
  sectionTitle: "Настройки",
  buttonOn: "ВКЛ",
  buttonOff: "ВЫКЛ",
  buttonLoading: "…",
  rowLoading: "Загрузка…",
  saveError: "Не удалось сохранить — попробуй ещё раз",
  toggles: {
    quotaChatNotifications: {
      title: "Уведомления о лимите в чате",
      on: "Бот пишет ученику об остатке и исчерпании лимита.",
      off: "Бот молчит про лимит. Ученик видит остаток в мини-приложении.",
    },
    billingStars: {
      title: "Telegram Stars (оплата)",
      // The "off" copy is the new safe default — manual billing only.
      on: "Кнопка «Оплатить» открывает Telegram Stars. Перед включением убедись, что готов принимать оплату через Stars.",
      off: "Оплата только вручную через админа. Кнопки «Оплатить» закрыты, инвойсы Stars не создаются.",
    },
    displayAnonymousHandles: {
      title: "Анонимные имена (псевдонимы)",
      // OFF (default) = real names; ON = animal handles. So "on" describes
      // the unusual choice and "off" describes the default behaviour.
      on: "Везде показываем псевдонимы вида «Гордый Орёл» 🦅 и эмодзи-аватары вместо имён и фото.",
      off: "В чатах и инбоксе показываем настоящее имя (как ученик указал в онбординге) и фото из Telegram.",
    },
    mediaUploadsTeachers: {
      title: "Загрузка медиа учителями",
      on: "Учителя могут загружать файлы в общую медиа-библиотеку. Удалить или изменить файл может только загрузивший или админ.",
      off: "Загружать в библиотеку могут только админы. Учителя всё равно отправляют учащимся файлы из библиотеки.",
    },
  },
};

const tags = {
  sectionTitle: "Теги медиа-библиотеки",
  newTagPlaceholder: "Новый тег",
  addButton: "Добавить",
  deleteButton: "Удалить",
  empty: "Тегов пока нет.",
  usageCount: (n: number) => `${n} материалов`,
  notUsed: "не используется",
  addFailed: "не удалось добавить",
  deleteFailed: "не удалось удалить",
  alreadyExists: (name: string) => `Уже существует: ${name}`,
  deleteConfirmTitle: (name: string) => `Удалить тег «${name}»?`,
  deleteConfirmBody: (n: number) => `Тег будет снят с ${n} материалов.`,
  deleteConfirmBodyEmpty: "Этот тег пока ни к чему не привязан.",
};

const connections = {
  sectionTitle: "Связи",
  studentsLabel: "Ученики",
  teachersLabel: "Тренеры",
  studentsEmpty: "Учеников нет",
  teachersEmpty: "Тренеров нет",
  buttonChooseBoth: "Выбери учеников и тренеров",
  buttonAllExist: "Все выбранные пары уже связаны",
  buttonPair: (n: number, word: string) => `Связать (${n} ${word})`,
  willCreate: "Будет создано:",
  alreadyExistOne: (n: number, word: string) => `(${n} ${word} уже существует)`,
  alreadyExistMany: (n: number, word: string) => `(${n} ${word} уже существуют)`,
  resultCreated: (n: number) => `Создано: ${n}`,
  resultSkipped: (n: number) => ` · пропущено: ${n}`,
  resultFailed: (n: number) => ` · ошибок: ${n}`,
  byStudents: "По ученикам",
  byTeachers: "По тренерам",
  searchPlaceholder: "Поиск по имени",
  noLinks: "Пока нет связей.",
  noMatch: "Никого не нашлось.",
  unlinkLabel: "Удалить связь",
  secondaryNounTeacher: "преп.",
  secondaryNounStudent: "уч.",
  fallbackName: (id: number) => `ID ${id}`,
};

export const admin = {
  settings,
  tags,
  connections,
};
