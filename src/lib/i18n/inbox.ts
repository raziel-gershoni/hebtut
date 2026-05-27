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
  },
  noTeacherBadge: "без тренера",
  unansweredAria: "ждёт ответа",
  studentInactiveAria: "ученик давно не отвечает",
  newClaimAction: "+ Написать ученику",
};

const inboxPage = {
  pageTitle: "Входящие",
  empty: "Пока ничего нет. Сюда придут сообщения от твоих учеников.",
  teachersOnly: "Только для тренеров.",
};

const feedbackPage = {
  pageTitle: "Обратная связь",
  adminHint: "У админов нет личной обратной связи — они отвечают другим.",
  adminNav: "→ Открыть обратную связь",
};

const thread = {
  takingByOtherFn: (teacher: string) => `Берёт ${teacher}`,
  studentRoleLabel: "ученик",
  studentFallbackName: "Ученик",
  teacherFallbackName: "Тренер",
  selfName: "Ты",
  attachMediaAriaLabel: "Прикрепить медиа из библиотеки",
  attachMediaTitle: "Медиа-библиотека",
  initiateButton: "+ Написать",
  activeSessionHint: "Активная сессия с этим учеником — отвечай в чате.",
  noMessages: "Сообщений ещё нет.",
  initiateErrors: {
    takenByOther: "Другой тренер сейчас работает с этим учеником",
    notAllowed: "Связь с этим учеником утрачена",
    generic: "Не удалось — попробуй ещё раз",
  },
};

const assignTeacher = {
  dialogTitle: "Назначить тренера",
  studentLabel: "Ученик:",
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
    "Если бот расслышал не точно — поправь текст. Ученику в Telegram придёт исправление.",
  transcriptSaveButton: "Сохранить",
  transcriptCancelButton: "Отмена",
  transcriptSaveError: "Не получилось сохранить — попробуй ещё раз.",
  editTranslationAria: "Изменить перевод",
  translationDialogTitle: "Перевод",
  translationDialogHint:
    "Если перевод неточный — поправь текст. Ученику в Telegram придёт исправление.",
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
  sendNoAccess: "нет доступа к ученику",
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
  errorTakenByOther: "Другой тренер сейчас работает с этим учеником",
  errorNotAllowed: "Связь с этим учеником утрачена",
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
  student: "ученик",
  teacher: "тренер",
};

export const inbox = {
  dateSeparator,
  row,
  inboxPage,
  thread,
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
