export const ru = {
  greetingRegistered: "Привет! Зарегистрировался. Жди — администратор подключит тебя.",
  greetingStudentNew: "Привет! Регистрация прошла. Я готов слушать твои голосовые и круглые видео.",
  greetingTeacher: "Привет, тренер! Открой мини-приложение, чтобы видеть входящие.",
  greetingStudent: (remaining: string) =>
    `Привет! Я готов слушать. На сегодня у тебя осталось ${remaining}.`,
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
    `📩 Ответь ${studentName} — голосовое ${dur}, отправлено ${when}. Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  teacherFollowupPrompt: (studentName: string, dur: string, when: string) =>
    `📩 Доп. ответ для ${studentName} — голосовое ${dur} (отправлено ${when}). Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  teacherInitiatePrompt: (studentName: string) =>
    `📩 Сообщение для ${studentName}. Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
  teacherNotificationActionable: (studentName: string, kindLabel: string, durationLabel: string) =>
    `🔔 ${studentName} прислал(а) ${kindLabel} ${durationLabel}. Открой мини-приложение, чтобы взять в работу.`,
  teacherNotificationTaken: (handler: string) => `✓ ${handler} взял(а) сообщение в работу.`,
  teacherNotificationExpired: "⚠️ Время на ответ истекло, сообщение снова доступно.",
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
