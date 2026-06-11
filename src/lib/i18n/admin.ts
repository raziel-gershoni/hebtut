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
      on: "Бот пишет пользователю об остатке и исчерпании лимита.",
      off: "Бот молчит про лимит. Пользователь видит остаток в мини-приложении.",
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
      off: "В чатах и инбоксе показываем настоящее имя (как пользователь указал в онбординге) и фото из Telegram.",
    },
    mediaUploadsTeachers: {
      title: "Загрузка медиа учителями",
      on: "Учителя могут загружать файлы в общую медиа-библиотеку. Удалить или изменить файл может только загрузивший или админ.",
      off: "Загружать в библиотеку могут только админы. Учителя всё равно отправляют пользователям файлы из библиотеки.",
    },
    transcripts: {
      title: "Авто-расшифровка голосовых",
      on: "После каждого голосового или кружка тренера пользователь получает текстовую расшифровку в Telegram.",
      off: "Расшифровка не отправляется. Можно включить, если пользователям нужен текст к аудио.",
    },
    translation: {
      title: "Перевод на русский",
      on: "К расшифровке тренера добавляется перевод на русский — отдельным сообщением. Если тренер говорит по-русски, перевод не присылается.",
      off: "Только расшифровка, без перевода.",
    },
    referrals: {
      title: "Реферальная программа",
      on: "Пользователи могут приглашать друзей по ссылке. За первую оплату приглашённого оба получают бонусные дни.",
      off: "Приглашения отключены: раздел в мини-приложении скрыт, новые переходы по ссылкам не засчитываются, бонусы за оплату не начисляются.",
    },
  },
};

const userTranscripts = {
  dialogTitle: "Расшифровка и перевод",
  dialogHint: "Что присылать пользователю после голосового тренера.",
  transcriptsLabel: "Присылать расшифровку",
  translationLabel: "Присылать перевод на русский",
  saveButton: "Сохранить",
  cancelButton: "Отмена",
  saveError: "Не получилось сохранить — попробуй ещё раз.",
  menuItem: "Расшифровка и перевод",
  // Shown next to a per-user checkbox when the matching GLOBAL toggle
  // is off — i.e. the persisted user preference doesn't matter right
  // now because the feature is disabled centrally.
  globallyDisabledNotice: "Глобально отключено в настройках.",
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
  studentsLabel: "Пользователи",
  teachersLabel: "Тренеры",
  studentsEmpty: "Пользователей нет",
  teachersEmpty: "Тренеров нет",
  buttonChooseBoth: "Выбери пользователей и тренеров",
  buttonAllExist: "Все выбранные пары уже связаны",
  buttonPair: (n: number, word: string) => `Связать (${n} ${word})`,
  willCreate: "Будет создано:",
  alreadyExistOne: (n: number, word: string) => `(${n} ${word} уже существует)`,
  alreadyExistMany: (n: number, word: string) => `(${n} ${word} уже существуют)`,
  resultCreated: (n: number) => `Создано: ${n}`,
  resultSkipped: (n: number) => ` · пропущено: ${n}`,
  resultFailed: (n: number) => ` · ошибок: ${n}`,
  byStudents: "По пользователям",
  byTeachers: "По тренерам",
  searchPlaceholder: "Поиск по имени",
  noLinks: "Пока нет связей.",
  noMatch: "Никого не нашлось.",
  unlinkLabel: "Удалить связь",
  bulkPairTitle: "Создать связи",
  secondaryNounTeacher: "преп.",
  secondaryNounStudent: "уч.",
  fallbackName: (id: number) => `ID ${id}`,
};

const tutorWork = {
  sectionTitle: "Рабочее время тренеров",
  rangeTodayBtn: "Сегодня",
  rangeWeekBtn: "Эта неделя",
  rangeMonthBtn: "Этот месяц",
  customRangeFrom: "с",
  customRangeTo: "по",
  bucketActiveLabel: "актив",
  bucketPlaybackLabel: "прослушка",
  bucketRecordingLabel: "запись",
  periodTotalLabel: "Всего:",
  todayTotalLabel: "Сегодня:",
  noActivity: "Нет активности",
  loadError: "Не удалось загрузить",
};

const admins = {
  addButton: "Добавить админа",
  pickerTitle: "Новый админ",
  searchPlaceholder: "Поиск по имени или @username",
  pickerEmpty: "Никого не нашлось",
  emptyList: "Админов нет",
  confirmGrantTitle: "Сделать админом?",
  confirmGrantBody: (name: string) =>
    `${name || "Пользователь"} получит полный доступ к админке: пользователи, связи, настройки, рассылки.`,
  confirmRevokeTitle: "Снять права админа?",
  confirmRevokeBody: (name: string) =>
    `${name || "Пользователь"} потеряет доступ к админке.`,
  confirmRevokeSelfBody:
    "Это твои собственные права — ты потеряешь доступ к админке сразу после подтверждения.",
  revokeAria: (name: string) => `Снять права админа у ${name}`,
  saveError: "Не удалось сохранить — попробуй ещё раз",
};

const users = {
  sectionTitle: "Пользователи",
  refreshLabel: "Обновить список",
  legendStudent: "Пользователь",
  legendTeacher: "Тренер",
  legendAdmin: "Админ",
  searchPlaceholder: "Поиск по имени, @username, псевдониму, ID или роли",
  empty: "Никого не нашлось.",
  suspendedBadge: "На паузе",
  tgNameTitle: "Имя в Telegram",
  tgNamePrefix: "TG:",
  roleLabels: {
    pending: "Ожидает",
    student: "Пользователь",
    teacher: "Тренер",
  },
  // Role toggle button (the emoji chip on each row)
  roleSwitchTitle: (toLower: string) => `Сделать ${toLower}`,
  roleSwitchAriaLabel: (toLower: string) => `Сделать ${toLower}`,
  roleSwitchUnassignedTitle: "Не назначено",
  roleSwitchUnassignedAriaLabel: "Роль не назначена",
  // Kebab menu
  actionsAriaLabel: "Действия",
  menuEditName: "Изменить имя",
  menuSubscription: "Подписка",
  menuResetOnboarding: "Сбросить онбординг",
  menuSuspend: "Приостановить",
  menuResume: "Возобновить",
  menuDelete: "Удалить",
  menuBanForever: "Заблокировать навсегда",
  // ConfirmDialog titles
  confirmDeleteTitle: "Удалить пользователя?",
  confirmBanTitle: "Заблокировать навсегда?",
  confirmResetOnboardingTitle: "Сбросить онбординг?",
  confirmRoleTitle: "Подтвердить смену роли",
  // ConfirmDialog bodies
  confirmBanBody: (name: string) =>
    `${name || "Пользователь"} не сможет зарегистрироваться заново. Все его сообщения будут удалены.`,
  confirmDeleteBody: (name: string) =>
    `${name || "Пользователь"} будет удалён вместе с сообщениями. Он сможет зарегистрироваться заново.`,
  confirmResetOnboardingBody: (name: string) =>
    `${name || "Пользователь"} вернётся к экрану «Привет». При следующем /start бот снова покажет первое сообщение онбординга. Предпочитаемое имя и таймеры тоже очистятся.`,
  confirmRoleBody:
    "Это действие может разорвать существующие связи пользователь↔тренер. Продолжить?",
  openTgProfileAria: "Открыть профиль в Telegram",
  openTgProfileNoUsername: "У пользователя нет публичного @username — профиль не открыть",
  openTgProfileSentToBot:
    "Открой чат с ботом — там ссылка на профиль. Нажми на неё, и откроется профиль.",
  openTgProfileSendFailed: "Не удалось отправить ссылку на профиль.",
  openTgProfilePrivacy:
    "У пользователя закрыт профиль настройками приватности. В чате с ботом — его ID для поиска.",
  // SubscriptionBadge labels
  subBadgeQueued: "в очереди",
  subBadgeTrial: (date: string) => `trial → ${date}`,
  subBadgeActiveUntil: (date: string) => `до ${date}`,
  subBadgeActive: "активна",
  subBadgeFrozenUntil: (date: string) => `🧊 ${date}`,
  subBadgeFrozen: "🧊",
  subBadgeTrialExpired: "trial ✕",
  subBadgeLapsed: "закрыта",
  subBadgePaymentFailed: "оплата ✕",
};

const subscription = {
  dialogTitle: "Подписка",
  activateHeader: "Активировать",
  dangerHeader: "Опасные действия",
  customDaysPlaceholder: "дней",
  activateButton: "Активировать",
  showCustomLink: "+ другое количество дней",
  resetTrialButton: "Сбросить на пробный период (2 дня)",
  lapseButton: "Закрыть подписку",
  closeButton: "Закрыть",
  patchError: "Не получилось — попробуй ещё раз.",
  customRangeError: "Введи целое число от 1 до 3650.",
  quickGrantYear: "+1 год",
  quickGrantDays: (n: number) => `+${n} дней`,
  resetConfirmTitle: "Сбросить на пробный период?",
  resetConfirmBody:
    "Подписка вернётся на 2 дня пробного периода. Активный платный период обнулится — вернуть его можно только повторной активацией.",
  lapseConfirmTitle: "Закрыть подписку?",
  lapseConfirmBody:
    "Подписка закроется немедленно. На следующее голосовое пользователь получит сообщение 'Доступ закрыт'.",
  noData: "Нет данных о подписке.",
  currentPrefix: "Сейчас:",
  frozenUntil: (date: string) => `Заморозка до ${date}`,
  summary: {
    queued: "В очереди",
    trial: "Пробный период",
    active: "Активна",
    trialExpired: "Пробный закончился",
    lapsed: "Закрыта",
    paymentFailed: "Платёж не прошёл",
    frozen: "Заморожена",
  },
  detail: {
    queued: "ждёт первого тренера",
    trialUntil: (date: string) => `до ${date}`,
    activeUntil: (date: string) => `до ${date}`,
    activeNoPeriod: "период не задан",
    trialExpiredOn: (date: string) => `пробный закончился ${date}`,
    lapsedOn: (date: string) => `закрылась ${date}`,
    lapsedNoPeriod: "доступ закрыт",
    paymentFailed: "оплата требует обновления",
    frozenPeriodUntil: (date: string) => `период до ${date}`,
    frozenNoPeriod: "период не задан",
  },
};

const onboardingVideos = {
  sectionTitle: "Видео онбординга",
  description: (cap: number) =>
    `Бот отправляет пользователю как круглое видео-сообщение (TG video_note). ` +
    `Каждый файл автоматически обрезается по центру в квадрат 640×640 и ` +
    `до 60 секунд. Можно загрузить до ${cap} клипов в один шаг — бот ` +
    `пришлёт первый сразу, остальные подтянутся через фоновый воркер с ` +
    `интервалом < 1 минуты (создаётся ощущение, что видео записываются в ` +
    `реальном времени). Кодирование в браузере занимает несколько минут ` +
    `на файл ради максимального качества.`,
  loadFailed: "не удалось загрузить",
  deleteFailed: "не удалось удалить",
  moveFailed: "не удалось переместить",
  // Per-step labels
  slotMeta: {
    video1: {
      title: "Видео 1",
      when: "После кнопки «Привет» — первый блок онбординга.",
    },
    video2: {
      title: "Видео 2",
      when: "После видео 1 — перед вопросом про имя.",
    },
    video3: {
      title: "Видео 3",
      when: "Через ~5 минут после первого ответа тренера — мини-объяснялка.",
    },
  },
  emptyStep: "Не загружено — пока используется текст-заглушка.",
  addClipButton: "+ Добавить клип",
  replaceButton: "Заменить",
  deleteClipButton: "Удалить",
  moveUpAriaLabel: "Переместить вверх",
  moveDownAriaLabel: "Переместить вниз",
  openInBrowser: "открыть",
  videoLoadFailedPrefix: "видео не загружается:",
  deleteConfirmTitle: (position: number) => `Удалить клип #${position}?`,
  deleteConfirmBody:
    "Если это был единственный клип в шаге, бот снова будет показывать текст-заглушку, пока не загрузишь новое.",
  prepFailed: (msg: string) => `не удалось подготовить видео: ${msg}`,
  stillTooLarge: (size: string) =>
    `после сжатия файл всё ещё ${size} — попробуй обрезать клип`,
  uploadFailed: (msg: string) => `не удалось загрузить файл в хранилище: ${msg}`,
  unsupportedMime: "только mp4 / mov / webm",
  presignFailed: (status: number) => `не удалось получить путь для загрузки: ${status}`,
  capReached: (cap: number) => `больше ${cap} клипов на шаг нельзя`,
  registerFailed: (body: string) => `не удалось зарегистрировать загрузку: ${body}`,
  fileEmpty: "пустой файл",
  fileTooLarge: (size: string) => `файл больше ${size}`,
  compressingLabel: (preset: string) => `Сжимаем видео (${preset})…`,
  uploadingLabel: (loaded: string, total: string) => `Загружаем… ${loaded} / ${total}`,
};

const audit = {
  sectionTitle: "Журнал действий",
  resetFilters: "Сбросить",
  actorPlaceholder: "Кто (user.id)",
  subjectPlaceholder: "Объект (subject_id)",
  empty: "Ничего не найдено по этим фильтрам.",
  systemActor: "system",
  loadMore: "Загрузить ещё",
  loadingMore: "...",
  rangeOptions: {
    "1h": "За час",
    "24h": "За 24 часа",
    "7d": "За неделю",
    "30d": "За 30 дней",
  },
  groups: {
    sessions: "Сессии",
    messages: "Сообщения",
    admin: "Админ",
    invites: "Приглашения",
    links: "Связи",
    registration: "Регистрация",
    feedback: "Связь",
    unknown: "?",
  },
  actions: {
    "claim.refresh": "Сессия",
    "claim.expire": "Истекла сессия",
    "message.in": "От пользователя",
    "message.out": "От тренера",
    "message.scheduled": "Отложено",
    "transcript.failed": "Сбой расшифровки",
    "translation.failed": "Сбой перевода",
    "client.media_error": "Сбой медиа у клиента",
    "media.fallback_served": "Голос через прокси",
    "admin.role_change": "Смена роли",
    "admin.is_admin_change": "Права админа",
    "admin.status_change": "Статус",
    "admin.user_delete": "Удалён",
    "admin.user_ban": "Забанен",
    "admin.user_unban": "Разбанен",
    "admin.invite_create": "Создал ссылку",
    "admin.invite_revoke": "Отозвал ссылку",
    "admin.acquisition_source_create": "Создал источник",
    "admin.acquisition_source_revoke": "Отозвал источник",
    "acquisition.attributed": "Привязка к источнику",
    "admin.link_create": "Связал",
    "admin.link_delete": "Разорвал связь",
    "invite.consume": "Активировал ссылку",
    "signup.student": "Регистрация пользователя",
    "signup.teacher": "Регистрация тренера",
    "feedback.in": "Обратная связь",
    "feedback.out": "Ответ админа",
    "feedback.claim_refresh": "Берёт обратную связь",
    "feedback.claim_expire": "Истёк клейм связи",
    "notification.admin_new_user": "Пинг админам о регистрации",
  },
};

const bannedUsers = {
  sectionTitle: "Заблокированные",
  unbanButton: "Разблокировать",
  unknownNamePrefix: (id: number) => `user ${id}`,
};

const invites = {
  sectionTitle: "Приглашения тренеров",
  createButton: "+ Создать ссылку",
  newReadyHint: "Новая ссылка готова — отправь будущему тренеру:",
  copyButton: "Копировать",
  copiedTick: "✓",
  openButton: "Открыть",
  emptyState: "Пока нет ссылок. Создай первую.",
  emptyStateActive: "Активных ссылок нет.",
  revokeButton: "Отозвать",
  showInactiveButton: (n: number) => `Показать неактивные (${n})`,
  hideInactiveButton: "Скрыть неактивные",
  stateLabels: {
    active: "Активна",
    consumed: "Использована",
    revoked: "Отозвана",
  },
};

const acquisitionSources = {
  sectionTitle: "Источники привлечения",
  hint: "Многоразовые ссылки для рекламы. Каждая регистрация по такой ссылке привязывается к источнику — потом увидишь, откуда пришёл пользователь.",
  labelPlaceholder: "Например, Instagram май 2026",
  createButton: "+ Создать источник",
  copyButton: "Копировать",
  copiedTick: "✓",
  openButton: "Открыть",
  revokeButton: "Отозвать",
  emptyState: "Пока нет источников. Создай первый.",
  emptyStateActive: "Активных источников нет.",
  showInactiveButton: (n: number) => `Показать неактивные (${n})`,
  hideInactiveButton: "Скрыть неактивные",
  signupCount: (n: number) => `регистраций: ${n}`,
  stateLabels: {
    active: "Активен",
    revoked: "Отозван",
  },
};

const versionFooter = {
  unknown: "версия не определена",
  builtPrefix: "собрано",
};

const editName = {
  dialogTitle: "Имя пользователя",
  tgLabel: "Telegram:",
  preferredLabel: "Предпочитаемое имя",
  inputPlaceholderFallback: "Имя",
  helpText:
    "Это имя видят другие тренеры в чатах. Если пусто — покажем имя из Telegram.",
  saveError: "Не получилось — попробуй ещё раз.",
  resetButton: "Сбросить",
  cancelButton: "Отмена",
  saveButton: "Сохранить",
  resetConfirmTitle: "Сбросить предпочитаемое имя?",
  resetConfirmBody:
    "Везде вернётся имя из Telegram. Это действие можно отменить, заново вписав имя.",
};

const userChecklist = {
  searchPlaceholder: "🔍 поиск",
  fallbackName: (id: number) => `ID ${id}`,
  showMore: (n: number) => `показать ещё (${n})`,
};

const pages = {
  // /admin
  pageTitle: "Админка",
  adminsOnly: "Только для администраторов.",
  navFeedback: "→ Обратная связь",
  navAudit: "→ Журнал действий",
  sections: {
    users: "Пользователи",
    admins: "Админы",
    connections: "Связи",
    settings: "Настройки",
    onboardingVideos: "Видео онбординга",
    tags: "Теги медиа-библиотеки",
    mediaLibrary: "Медиа-библиотека",
    invites: "Приглашения тренеров",
    acquisitionSources: "Источники привлечения",
    tutorWork: "Рабочее время тренеров",
    banned: "Заблокированные",
  },
  // /admin/feedback + /admin/feedback/[userId]
  feedbackPageTitle: "Обратная связь",
  // /admin/audit
  auditPageTitle: "Журнал",
  invalidUserId: "Неверный идентификатор пользователя.",
};

const mediaLibrary = {
  openButton: "Открыть медиа-библиотеку",
};

export const admin = {
  settings,
  tags,
  connections,
  tutorWork,
  users,
  admins,
  subscription,
  onboardingVideos,
  audit,
  bannedUsers,
  invites,
  acquisitionSources,
  versionFooter,
  editName,
  userChecklist,
  pages,
  mediaLibrary,
  userTranscripts,
};
