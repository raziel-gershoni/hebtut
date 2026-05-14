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
  manualBillingButton: "Связаться с админом",
  subscriptionGrantedDM: (days: number, until: string) => {
    const word = days % 10 === 1 && days % 100 !== 11
      ? "день"
      : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 11 || days % 100 > 14)
        ? "дня"
        : "дней";
    return `🎁 Тренер активировал подписку на ${days} ${word}. Активна до ${until}. Записывай голосовые!`;
  },
  subscriptionResetDM:
    "Подписка сброшена на пробный период (3 дня). Запиши голосовое — тренер ждёт.",
  subscriptionLapsedDM:
    "Подписка приостановлена. Свяжись с админом, чтобы возобновить.",

  // ─── Onboarding decision tree (steps 1–14) ─────────────────────────────
  // Step 1: welcome on first /start. Single CTA button.
  onbStep1Welcome:
    "Начни говорить на иврите уже сегодня.\n" +
    "И двигайся шаг за шагом через живую практику.\n" +
    "Без уроков и зубрёжки.",
  onbStep1Button: "Начать",

  // Step 2: Video 1 placeholder (real video coming later — single string swap).
  onbVideo1Placeholder:
    "🎬 [Видео 1] Превью появится позже.\n\n" +
    "Самуэль рассказывает, как работает сервис: ты записываешь голосовое " +
    "или видео-кружок — живой тренер отвечает. Это пинг-понг: чтобы " +
    "заговорить, нужен живой ответ и продолжение диалога.",
  onbStep2Button: "Продолжить",

  // Step 3: Video 2 placeholder.
  onbVideo2Placeholder:
    "🎬 [Видео 2] Превью появится позже.\n\n" +
    "5 минут практики в день — не копятся, чтобы был ритм каждый день. " +
    "Ошибаться нормально. Тренер ведёт разговор, задаёт темп, не даёт " +
    "выпасть. Цель — постепенно переводить тебя в уверенную речь.",
  onbStep3Button: "Дальше",

  // Step 3.5: name capture (between video2 and the record-CTA). No button —
  // student types their first name in chat, the bot stores it as users.name.
  onbNameAsk:
    "Как мне к тебе обращаться?\nНапиши имя — короткое, как хочешь.",
  onbNameTooLong: "Слишком длинно. Попробуй короче (до 50 символов).",
  onbNameTooShort: "Не понял. Напиши имя одним словом или фразой.",
  onbNameThanks: (name: string) => `Приятно познакомиться, ${name}!`,

  // Step 4: pure CTA, no button. Student is expected to record voice.
  onbStep4CtaRecord:
    "Запиши голосовое или видео-кружок на иврите.\n" +
    "Расскажи о себе: чем занимаешься или как прошёл день.\n" +
    "Не думай долго — говори как получается.",

  // Step 5: 2h soft nudge.
  onbStep5Nudge2h:
    "Самое сложное — начать.\n" +
    "Скажи хоть что-то.\n" +
    "Даже одно слово, например «шалом».\n" +
    "Дальше станет проще.",

  // Step 6: 24h hard nudge (deferred for quiet hours).
  onbStep6Nudge24h:
    "Если ты сейчас не попробуешь — дальше не сдвинется.\n" +
    "Здесь всё работает только через практику.\n" +
    "Запиши короткое голосовое и попробуй.",

  // Step 8: meta-explainer 5min after first teacher reply.
  onbStep8MetaExplainer:
    "Вот так это и работает: ты говоришь → тренер отвечает → разговор " +
    "продолжается.\nПродолжай, именно в этом моменте появляется речь.",

  // Step 9: day-1 limit hit. Soft "you're done for today" with no CTA.
  onbStep9Day1LimitDone:
    "На сегодня практики более чем достаточно 👍.\nВажно просто вернуться " +
    "завтра и продолжить.",

  // Step 10: day-2+ pause nudge after 6h inactivity.
  onbStep10PauseNudge:
    "Не останавливайся.\nДаже короткие ответы дают результат, если делать " +
    "это каждый день.",

  // Step 11: end of trial → conversion CTA.
  onbStep11Day2Conversion:
    "Пробные 2 дня завершены.\nФормат уже понятен: живой тренер, практика " +
    "каждый день, движение шаг за шагом.\nТеперь главное — не терять темп.",
  onbStep11Button: "Оплатить и продолжить практику",

  // Step 12: survey 1d after trial expiry without payment.
  onbStep12Survey:
    "Привет, на связи Самуэль.\nВижу, ты уже попробовал формат.\n" +
    "Планируешь продолжить?",
  onbSurveyYes: "Да",
  onbSurveyLater: "Позже",
  onbSurveyNo: "Нет",

  // Step 12.1: Yes → "open access".
  onbStep12_1Yes:
    "Отлично.\nТогда можно открыть доступ и вернуться к практике.",
  onbStep12_1Button: "Открыть доступ",

  // Step 12.2: Later → "I'll remind you".
  onbStep12_2Later:
    "Понял.\nТогда напомню позже, чтобы можно было спокойно вернуться.",

  // Step 12.3: No / 5d-after-Later → Video 3 + chat-support button.
  onbVideo3Placeholder:
    "🎬 [Видео 3] Превью появится позже.\n\n" +
    "Привет, на связи снова Самуэль. Если есть пара минут — скажи, что " +
    "именно не зашло или чего не хватило. Можно коротко: текстом или " +
    "голосом. Когда нажмёшь «Ответить Самуэлю», откроется отдельный чат. " +
    "Сообщения попадут только мне, никто больше их не видит.",
  onbVideo3Button: "Ответить Самуэлю",

  // Stale-button reply for callback_query when state has moved on.
  onbStaleButton: "Кнопка устарела",
  frozenNotice: (until: string) =>
    `Заморозка активна до ${until}. Сообщения снова начнут приходить тренеру после неё.`,
  paymentSucceeded: (until: string) =>
    `Спасибо! Подписка активна до ${until}. Запиши голосовое — тренер уже ждёт.`,
  trialEndsTomorrow:
    "Завтра заканчивается пробный период. Чтобы продолжить — открой и оплати подписку.",
  trialEndsToday: "Сегодня последний день пробного периода. Не теряй темп — оплати, пока не остановилось.",
  subscriptionEndsTomorrow: "Завтра заканчивается подписка. Продли, чтобы тренер не пропадал.",
  subscriptionEndsToday: "Сегодня заканчивается подписка. Продли — практика продолжится без перерыва.",
  freezeActivated: (days: number) => {
    const word = days === 1 ? "день" : days >= 2 && days <= 4 ? "дня" : "дней";
    return `Заморозка включена на ${days} ${word}.\nПодписка автоматически продлится.`;
  },
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
  teacherReplyScheduled: (time: string) =>
    `✅ Запланировано. Ученик получит сообщение в ${time} — он попросил приходить только в это время.`,
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
