export const ru = {
  greetingRegistered: "Привет! Зарегистрировался. Жди — администратор подключит тебя.",
  greetingTeacher: "Привет, преподаватель! Открой мини-приложение, чтобы видеть входящие.",
  greetingStudent: (remaining: string) =>
    `Привет! Я готов слушать. На сегодня у тебя осталось ${remaining}.`,
  unknownInput: "Я понимаю только голосовые и круглые видео. Попробуй ещё раз.",
  pendingNotice: "Сообщение сохранено. Жди — администратор подключит тебя к преподавателю.",
  noTeachers:
    "Сообщение принято, но за тобой пока не закреплён ни один преподаватель. Сообщи администратору.",
  overQuota: (remaining: string) =>
    `На сегодня лимит почти исчерпан — осталось ${remaining}. Попробуй завтра или сократи запись.`,
  acceptedStudent: (remaining: string) => `✅ Отправлено! Осталось ${remaining} на сегодня.`,
  teacherReplyMissingContext:
    "Чтобы ответить ученику, открой мини-приложение, нажми «Ответить» рядом с его сообщением, и потом свайпни по подсказке.",
  teacherReplyDelivered: "✅ Ответ отправлен ученику.",
  teacherReplyFailed: "Не удалось отправить ответ. Попробуй ещё раз через мини-приложение.",
  teacherClaimPrompt: (studentName: string, dur: string) =>
    `📩 Ответь ${studentName} — голосовое ${dur}. Свайпни влево по этому сообщению и запиши голосовое или круглое видео.`,
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
