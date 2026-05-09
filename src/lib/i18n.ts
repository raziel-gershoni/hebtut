export const ru = {
  greetingRegistered: "Привет! Зарегистрировался. Жди — администратор подключит тебя.",
  greetingStudentNew: "Привет! Регистрация прошла. Я готов слушать твои голосовые и круглые видео.",
  greetingTeacher: "Привет, тренер! Открой мини-приложение, чтобы видеть входящие.",
  greetingStudent: (remaining: string) =>
    `Привет! Я готов слушать. На сегодня у тебя осталось ${remaining}.`,
  greetingStudentNeutral: "Привет! Я готов слушать.",
  inviteConsumedTeacher: "Привет, тренер! Ссылка активирована.",
  upgradedToTeacher: "Готово — теперь ты тренер.",
  inviteRevokedOrUsed: "Ссылка недействительна или уже использована.",
  suspendedNotice: "Доступ временно приостановлен. Свяжитесь с администратором.",
  unknownInput: "Я понимаю только голосовые и круглые видео. Попробуй ещё раз.",
  pendingNotice: "Сообщение сохранено. Жди — администратор подключит тебя к тренеру.",
  noTeachers:
    "Сообщение принято, но за тобой пока не закреплён ни один тренер. Сообщи администратору.",
  overQuota: (remaining: string) =>
    `На сегодня осталось ${remaining}. Сократи запись или попробуй завтра.`,
  overQuotaExhausted: "Лимит на сегодня исчерпан. Попробуй завтра.",
  // Neutral variants used when chat-side quota notifications are off (the
  // admin toggle in app_settings). Quota is still enforced; the student
  // sees their remaining time on the Mini App home card instead.
  quotaRejectedNeutral:
    "Не удалось отправить. Открой мини-приложение, чтобы посмотреть статус.",
  acceptedStudentNeutral: "✅ Отправлено.",
  // Access gate: shown ONCE per 24h to a locked subscriber when they try to
  // send media. Server still rejects the message; this template gives them a
  // way back via the Mini App. Subsequent retries within 24h are silent.
  lockedTemplateText:
    "Сейчас сообщение не дошло до тренера.\n" +
    "Доступ к практике закончился, поэтому новые сообщения не передаются.\n\n" +
    "Чтобы продолжить разговор, нужно получить доступ.",
  lockedTemplateButton: "Оплатить",
  frozenNotice: (until: string) =>
    `Заморозка активна до ${until}. Сообщения снова начнут приходить тренеру после неё.`,
  paymentSucceeded: (until: string) =>
    `Спасибо! Подписка активна до ${until}. Запиши голосовое — тренер уже ждёт.`,
  referralCreditApplied: (days: number) =>
    `🎁 Твой друг оплатил подписку — твой доступ продлён на ${days} ${days === 1 ? "день" : days >= 2 && days <= 4 ? "дня" : "дней"}.`,
  acceptedStudent: (remaining: string) => `✅ Отправлено! Осталось ${remaining} на сегодня.`,
  acceptedStudentLow: (remaining: string) =>
    `✅ Отправлено! ⚠️ Осталось ${remaining} — меньше минуты на сегодня.`,
  acceptedStudentOverflow: (overflow: string) =>
    `✅ Отправлено! Лимит на сегодня исчерпан, ${overflow} списались с завтрашнего лимита.`,
  teacherReplyMissingContext:
    "Чтобы ответить ученику, открой мини-приложение, нажми «Ответить» рядом с его сообщением, и потом свайпни по подсказке.",
  teacherReplyDelivered: "✅ Ответ отправлен ученику.",
  teacherReplyFailed: "Не удалось отправить ответ. Попробуй ещё раз через мини-приложение.",
  teacherClaimPrompt: (studentName: string, dur: string, when: string) =>
    `📩 От: ${studentName}. Голосовое ${dur}, отправлено ${when}. Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  teacherFollowupPrompt: (studentName: string, dur: string, when: string) =>
    `📩 Доп. ответ. От: ${studentName}. Голосовое ${dur} (отправлено ${when}). Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  teacherInitiatePrompt: (studentName: string) =>
    `📩 Кому: ${studentName}. Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  adminFeedbackPing: (userLabel: string, snippet: string) =>
    `💬 От ${userLabel}: «${snippet}». Открой админку, чтобы ответить.`,
  userFeedbackReplyPing:
    "💬 Новый ответ от админа. Открой обратную связь, чтобы прочитать и ответить.",
  teacherNotificationActionable: (studentName: string, kindLabel: string, durationLabel: string) =>
    `🔔 Новое: ${kindLabel} ${durationLabel} от ${studentName}. Открой мини-приложение, чтобы взять в работу.`,
  teacherNotificationTaken: (handler: string, studentHandle: string) =>
    `✓ ${studentHandle}: в работе у ${handler}.`,
  teacherNotificationExpired: "⚠️ Время на ответ истекло, сообщение снова доступно.",
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
