/**
 * Student-side Mini App copy. Sub-groups: `menu`, `summary`, `freeze`,
 * `referrals`, `responseWindow`, `home`.
 */

const menu = {
  items: {
    feedback: {
      title: "Поддержка",
      subtitle: "Связаться с админом или ответить на видео-просьбу",
    },
    referrals: {
      title: "Рефералы",
      subtitle: "Пригласи друга — оба получите +30 дней",
    },
    freeze: {
      title: "Заморозка",
      subtitle: "Поставить практику на паузу до 3 дней в месяц",
    },
    responseWindow: {
      title: "Время ответа",
      subtitle: "Когда тренеру можно начинать диалог",
    },
    transcripts: {
      title: "Расшифровки и перевод",
      subtitle: "Что приходит после голосовых тренера",
    },
  },
};

const transcriptsPage = {
  pageTitle: "Расшифровки и перевод",
  studentsOnly: "Только для пользователей.",
  transcriptsTitle: "Расшифровка",
  transcriptsBody:
    "Текст того, что сказал тренер, приходит отдельным сообщением после голосового.",
  translationTitle: "Перевод на русский",
  translationBody:
    "Если тренер говорит не по-русски — придёт ещё и перевод. Если по-русски — перевод не нужен и не пришлётся.",
  saveButton: "Сохранить",
  savingButton: "Сохраняем…",
  saveError: "Не получилось сохранить — попробуй ещё раз.",
  globallyDisabledNotice: "Сейчас отключено для всех. Включи позже, когда заработает.",
};

const summary = {
  strip: {
    trial: (n: number, word: string, verb: string) =>
      `Пробный период • ${n} ${word} ${verb}`,
    trialEndsTodayShort: "Пробный период • заканчивается сегодня",
    trialEndsTomorrowShort: "Пробный период • заканчивается завтра",
    renewingToday: "Продление сегодня",
    renewingInDays: (n: number, word: string) => `Продление через ${n} ${word}`,
    trialExpired: "Пробный период закончился",
    lapsed: "Доступ закрыт",
    paymentFailed: "Не удалось списать оплату",
    frozenUntil: (date: string) => `Заморозка до ${date}`,
  },
  verbRemaining: "остался",
  verbRemainingPlural: "осталось",
  // Main line copy
  practiceStopped: "Практика с тренером остановлена",
  practiceFrozen: "Доступ к практике на паузе",
  todayAvailable: (dur: string) => `Сегодня доступно ${dur} практики`,
  todayClosed: "Практика на сегодня закрыта 💪",
  // Streak
  streakChip: (n: number, word: string) => `🔥 ${n} ${word} подряд`,
  // PayCTA
  contactAdmin: "Связаться с админом",
  updatePayment: "Обновить оплату",
  pay30Days: "Оплатить — 30 дней",
  opening: "Открываем…",
  payOpenError: "Не удалось открыть оплату. Попробуй ещё раз.",
};

const freeze = {
  pageTitle: "Заморозка",
  studentsOnly: "Только для пользователей.",
  howItWorksHeader: "Как работает",
  budgetLine: (cap: number) =>
    `Можно заморозить доступ до ${cap} дней в месяц.`,
  extendsLine: "Это продлит подписку на время паузы.",
  effectsNextDayLine: "Заморозка действует со следующего дня после активации.",
  lockedHeader: "Заморозка недоступна",
  lockedFrozen: (date: string) =>
    `Подписка уже на паузе до ${date}.`,
  lockedFrozenHint: "Новая заморозка станет доступна, когда текущая закончится.",
  lockedNonActive: "Заморозка доступна только при активной подписке.",
  pickerHeader: "Сколько дней заморозить",
  budgetSummary: (used: number, total: number) =>
    `На этот месяц доступно: ${used} из ${total}.`,
  oneDay: "день",
  twoDays: "дня",
  errorNotActive: "Заморозка доступна только при активной подписке.",
  errorBudgetExceeded: "На этот месяц лимит уже исчерпан.",
  errorGeneric: "Не получилось — попробуй позже.",
  activatingButton: "Включаем…",
  activateButton: "Заморозить со следующего дня",
};

const referrals = {
  pageTitle: "Рефералы",
  studentsOnly: "Только для пользователей.",
  lockedHeader: "Рефералы недоступны",
  lockedBody:
    "Реферальная программа откроется, когда закончится пробный период.",
  inviteFriendsHeader: "Приглашай друзей",
  friendsBodyPrefix: "Когда друг оплатит подписку, обоим прибавим",
  bonusBold: "+30 дней",
  bodyCapPrefix: ". Можно набрать до",
  bodyCapBold: "+90 дней бонуса",
  bodyCapSuffix: ".",
  linkLabel: "Твоя ссылка",
  copyButton: "Скопировать",
  copiedButton: "Скопировано ✓",
  shareButton: "Поделиться",
  shareTitle: "Попробуй HebTut",
  shareText: "Я тренируюсь говорить с тренером — попробуй и ты.",
  manualCopyPrompt: "Скопируй ссылку вручную:",
  statsHeader: "Статистика",
  statAttributed: "Пришли по ссылке",
  statPaid: "Оплатили",
};

const responseWindow = {
  pageTitle: "Время ответа",
  studentsOnly: "Только для пользователей.",
  whenHeader: "Когда тренеру можно начинать диалог",
  whenBody: [
    "Если тренер пишет первым — сообщение придёт только в выбранное время.",
    "На твои голосовые тренер отвечает сразу, без задержек.",
  ].join(" "),
  currentLine: (start: string, end: string, tz: string) =>
    `Сейчас: ${start} — ${end} (${tz})`,
  startLabel: "С",
  endLabel: "До",
  saveButton: "Сохранить",
  savingButton: "Сохраняем…",
  clearButton: "Получать в любое время",
  saveError: "Не получилось сохранить — попробуй ещё раз.",
  clearError: "Не получилось сбросить — попробуй ещё раз.",
};

const home = {
  roleLabels: {
    pending: "ждём подтверждения",
    student: "пользователь",
    teacher: "тренер",
  },
  adminTag: "АДМИН",
  greeting: (name: string) => `Привет, ${name}!`,
  fallbackName: "пользователь",
  pendingHint: "Жди — администратор подключит тебя в ближайшее время.",
  adminHint:
    "Ты администратор. Если хочешь ещё и принимать ответы — назначь себе роль «teacher» в админке.",
  inboxTitle: "Входящие",
  inboxSubtitleTeacher: "Сообщения от твоих пользователей",
  inboxSubtitleAdmin: "Просмотр всех диалогов (только чтение)",
  feedbackTitle: "Обратная связь",
  feedbackSubtitleAdmin: "Сообщения от пользователей в админ-пул",
  feedbackSubtitleUser: "Связаться с админом",
  adminPanelTitle: "Админка",
  adminPanelSubtitle: "Пользователи и связи пользователь↔тренер",
};

export const student = {
  menu,
  summary,
  freeze,
  referrals,
  responseWindow,
  transcriptsPage,
  home,
};
