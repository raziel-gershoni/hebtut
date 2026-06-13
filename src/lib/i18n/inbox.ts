/**
 * Inbox + thread shared Mini App copy. Sub-groups: `row`, `thread`,
 * `message`, `mediaPicker`, `assignTeacher`, `feedback`, `dateSeparator`,
 * `claim`, `tagPicker`, `studentPicker`, `mediaItem`, `mediaPreview`,
 * `appShell`, `inboxPage`, `feedbackPage`.
 */

const dateSeparator = {
  today: "Сегодня",
  yesterday: "Вчера",
};

const row = {
  ageOf: (when: string) => `· ${when}`,
  preview: {
    empty: "Пока пусто",
    youPrefix: "Ты: ",
    awaitsReply: " · ждёт ответа",
    photo: "Фото",
    video: "Видео",
    audio: "Аудио",
  },
  noTeacherBadge: "без тренера",
  unansweredAria: "ждёт ответа",
  studentInactiveAria: "пользователь давно не отвечает",
  newClaimAction: "+ Написать пользователю",
};

const quotaPill = {
  warning: (sec: number) => `⏱ Почти лимит · ${sec}с`,
  over: "⏰ Лимит достигнут",
  overBy: (sec: number) => `⏰ Превышен · +${sec}с`,
  warningAria: "Скоро лимит на сегодня",
  overAria: "Лимит на сегодня исчерпан",
};

const inboxPage = {
  pageTitle: "Входящие",
  empty: "Пока ничего нет. Сюда придут сообщения от твоих пользователей.",
  teachersOnly: "Только для тренеров.",
};

const feedbackPage = {
  pageTitle: "Обратная связь",
  adminHint: "У админов нет личной обратной связи — они отвечают другим.",
  adminNav: "→ Открыть обратную связь",
};

const thread = {
  takingByOtherFn: (teacher: string) => `Берёт ${teacher}`,
  studentRoleLabel: "пользователь",
  studentFallbackName: "Пользователь",
  teacherFallbackName: "Тренер",
  selfName: "Ты",
  attachMediaAriaLabel: "Прикрепить медиа из библиотеки",
  attachMediaTitle: "Медиа-библиотека",
  initiateButton: "+ Написать",
  cardButton: "Карточка",
  cardButtonAria: "Открыть карточку пользователя",
  activeSessionHint: "Активная сессия с этим пользователем — отвечай в чате.",
  noMessages: "Сообщений ещё нет.",
  initiateErrors: {
    takenByOther: "Другой тренер сейчас работает с этим пользователем",
    notAllowed: "Связь с этим пользователем утрачена",
    generic: "Не удалось — попробуй ещё раз",
  },
};

const studentCard = {
  dialogTitle: "Карточка пользователя",
  statusHeading: "Подписка",
  originHeading: "Откуда пришёл",
  originDirect: "Прямая регистрация",
  originReferral: (handle: string) => `По ссылке от ${handle}`,
  originSource: (label: string) => `По источнику «${label}»`,
  tagsHeading: "Теги",
  tagsEmptyDictionary: "Тегов пока нет — попроси администратора добавить.",
  tagsHint: "Нажми на тег, чтобы пометить/снять.",
  loadError: "не удалось загрузить",
  saveError: "не удалось сохранить",
  closeButton: "Закрыть",
  statusLabels: {
    queued: "В очереди",
    trial: (date: string) => `Пробный · до ${date}`,
    active: (date: string) => `Активна · до ${date}`,
    activeNoPeriod: "Активна",
    trial_expired: "Пробный закончился",
    lapsed: "Закрыта",
    payment_failed: "Платёж не прошёл",
    frozen: (date: string) => `🧊 до ${date}`,
    frozenNoDate: "🧊 Заморожена",
  },
};

const assignTeacher = {
  dialogTitle: "Назначить тренера",
  studentLabel: "Пользователь:",
  noTeachers: "В системе пока нет тренеров.",
  closeButton: "Закрыть",
  assignButton: (n: number) => `Назначить (${n})`,
  partialError: (failed: number, total: number) => `не удалось привязать ${failed}/${total}`,
  networkError: "сеть недоступна",
  loadError: "не удалось загрузить тренеров",
  fallbackName: (id: number) => `teacher ${id}`,
};

const appShell = {
  back: "Назад",
};

const message = {
  replyFeedbackOk: "✓ Свайпни по приглашению в чате",
  replyFeedbackTakenByOther: "Берёт другой тренер",
  replyFeedbackError: (reason: string) => `Ошибка: ${reason}`,
  replyFeedbackUnknownReason: "неизвестная",
  jumpToOriginalAriaLabel: "Перейти к исходному сообщению",
  playAriaLabel: "Воспроизвести",
  pauseAriaLabel: "Пауза",
  speedAriaLabel: (speed: string) => `Скорость воспроизведения: ${speed}`,
  speedTitle: "Скорость воспроизведения — нажми, чтобы изменить",
  closeAriaLabel: "Закрыть",
  openImageAriaLabel: "Открыть изображение",
  fileFallback: "Файл",
  editTranscriptAria: "Изменить расшифровку",
  transcriptDialogTitle: "Расшифровка",
  transcriptDialogHint:
    "Если бот расслышал не точно — поправь текст. Пользователю в Telegram придёт исправление.",
  transcriptSaveButton: "Сохранить",
  transcriptCancelButton: "Отмена",
  transcriptSaveError: "Не получилось сохранить — попробуй ещё раз.",
  editTranslationAria: "Изменить перевод",
  translationDialogTitle: "Перевод",
  translationDialogHint:
    "Если перевод неточный — поправь текст. Пользователю в Telegram придёт исправление.",
  translationSaveButton: "Сохранить",
  translationCancelButton: "Отмена",
  translationSaveError: "Не получилось сохранить — попробуй ещё раз.",
};

const mediaPicker = {
  kindAll: "Все",
  kindPhoto: "Фото",
  kindVideo: "Видео",
  kindAudio: "Аудио",
  loadError: "Не удалось загрузить библиотеку",
  unsupportedFormat: "Неподдерживаемый формат файла",
  emptyFile: "Пустой файл",
  fileTooLarge: (size: string) => `Файл больше ${size}`,
  compressError: (msg: string) => `не удалось сжать видео: ${msg}`,
  videoUnreadable:
    "Не получилось прочитать видео. Попробуй другой файл или открой админку с компьютера.",
  videoTooLong: (sec: number) =>
    `Видео длиннее ${Math.round(sec / 60)} минут. Обрежь перед загрузкой.`,
  stillTooLarge: (size: string) =>
    `после сжатия файл всё ещё ${size} — попробуй обрезать клип`,
  uploadsDisabled: "загрузка отключена администратором",
  unsupportedMime: "неподдерживаемый формат файла",
  presignFailed: (status: number) => `не удалось получить путь для загрузки: ${status}`,
  storageUploadFailed: (msg: string) => `не удалось загрузить в хранилище: ${msg}`,
  storageMissed: "загрузка в хранилище не дошла — попробуй ещё раз",
  registerFailed: (body: string) => `не удалось зарегистрировать загрузку: ${body}`,
  sendNoAccess: "нет доступа к пользователю",
  sendError: "не удалось отправить",
  deleteForbidden: "только загрузивший или админ",
  deleteError: "не удалось удалить",
  closeAriaLabel: "Закрыть",
  searchPlaceholder: "Поиск по названию или файлу",
  emptyLibrary: "Библиотека пуста",
  nothingFound: "Ничего не найдено",
  sendButton: "Отправить",
  uploadButton: "Загрузить",
  itemDescriptionPlaceholder: "Короткое описание для тренеров",
  deleteConfirmTitle: "Удалить материал?",
};

const mediaPreview = {
  selectAriaLabel: (title: string) => `Выбрать ${title}`,
  menuAriaLabel: "Меню",
};

const mediaItem = {
  editForbidden: "только загрузивший или админ",
  editError: "не удалось сохранить",
  descriptionPlaceholder: "Короткое описание для тренеров",
  saveButton: "Сохранить",
};

const tagPicker = {
  searchPlaceholder: "Поиск тегов…",
};

const claim = {
  replyButton: "Ответить",
};

const studentPicker = {
  errorTakenByOther: "Другой тренер сейчас работает с этим пользователем",
  errorNotAllowed: "Связь с этим пользователем утрачена",
  errorGeneric: "Не удалось — попробуй ещё раз",
  closeAriaLabel: "Закрыть",
  title: "Кому написать?",
};

const feedbackList = {
  youPrefix: "Ты: ",
  takingBySelf: "Берёшь ты",
  takingByOtherFn: (handler: string) => `Берёт ${handler}`,
};

const feedbackThread = {
  noMessages: "Сообщений нет.",
  takenByOtherFn: (handler: string) => `Сейчас отвечает ${handler} — попробуй позже`,
  takenByPlaceholderFn: (handler: string) => `Берёт ${handler}`,
  sendError: "Не удалось отправить — попробуй ещё раз",
  fallbackHandler: "другой админ",
  fallbackName: "—",
  draftPlaceholder: "Ответ",
  sendAriaLabel: "Отправить",
};

const feedbackChat = {
  sendError: "Не удалось отправить — попробуй ещё раз",
  adminFallback: "Админ",
  messagePlaceholder: "Сообщение",
  sendAriaLabel: "Отправить",
  emptyState: "Напиши админу, если что-то непонятно или нужна помощь. Ответ придёт сюда же.",
};

const appShellRoleLabels = {
  pending: "ожидание",
  student: "пользователь",
  teacher: "тренер",
};

export const inbox = {
  dateSeparator,
  row,
  quotaPill,
  inboxPage,
  thread,
  studentCard,
  assignTeacher,
  appShell,
  message,
  mediaPicker,
  mediaPreview,
  mediaItem,
  tagPicker,
  claim,
  studentPicker,
  feedbackList,
  feedbackThread,
  feedbackChat,
  feedbackPage,
  appShellRoleLabels,
};
