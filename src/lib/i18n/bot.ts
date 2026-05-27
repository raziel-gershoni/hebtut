/**
 * Every string the bot sends via `ctx.reply` / `bot.api.sendMessage`,
 * organized by flow. Keys formerly flat under the old i18n.ts ru object
 * have been regrouped here without copy changes.
 *
 * Function-shaped keys (`greetings.student(remaining)`, etc.) keep their
 * callable signatures — no migration to ICU MessageFormat yet; that's a
 * next-intl concern.
 */

import { pluralDay } from "./common";

const greetings = {
  registered: "Привет! Зарегистрировался. Жди — администратор подключит тебя.",
  studentNew: "Привет! Регистрация прошла. Я готов слушать твои голосовые и круглые видео.",
  teacher: "Привет, тренер! Открой мини-приложение, чтобы видеть входящие.",
  student: (remaining: string) =>
    `Привет! Я готов слушать. На сегодня у тебя осталось ${remaining}.`,
  studentNeutral: "Привет! Я готов слушать.",
};

const invites = {
  consumedTeacher: "Привет, тренер! Ссылка активирована.",
  upgradedToTeacher: "Готово — теперь ты тренер.",
  revokedOrUsed: "Ссылка недействительна или уже использована.",
};

const access = {
  suspendedNotice: "Доступ временно приостановлен. Свяжитесь с администратором.",
  unknownInput: "Я понимаю только голосовые и круглые видео. Попробуй ещё раз.",
  pendingNotice: "Сообщение сохранено. Жди — администратор подключит тебя к тренеру.",
  noTeachers:
    "Сообщение принято, но за тобой пока не закреплён ни один тренер. Сообщи администратору.",
  // Sent ONCE per student (gated on subscriptions.unassigned_ack_sent_at)
  // when an unassigned student records their first voice/video. Subsequent
  // recordings while still unassigned don't re-send this — admins still
  // get the fan-out ping every time.
  unassignedAck:
    "Получили твоё сообщение. Сейчас подключим тренера, и он скоро ответит.\n\n" +
    "А пока можешь продолжать записывать дальше, если хочется что-то ещё рассказать или добавить.",
};

const quota = {
  overQuota: (remaining: string) =>
    `На сегодня осталось ${remaining}. Сократи запись или попробуй завтра.`,
  overQuotaExhausted: "Лимит на сегодня исчерпан. Попробуй завтра.",
  // Neutral variants used when chat-side quota notifications are off (the
  // admin toggle in app_settings). Quota is still enforced; the student
  // sees their remaining time on the Mini App home card instead.
  rejectedNeutral:
    "Не удалось отправить. Открой мини-приложение, чтобы посмотреть статус.",
  acceptedNeutral: "✅ Отправлено.",
  accepted: (remaining: string) => `✅ Отправлено! Осталось ${remaining} на сегодня.`,
  acceptedLow: (remaining: string) =>
    `✅ Отправлено! ⚠️ Осталось ${remaining} — меньше минуты на сегодня.`,
  acceptedOverflow: (overflow: string) =>
    `✅ Отправлено! Лимит на сегодня исчерпан, ${overflow} списались с завтрашнего лимита.`,
};

const locked = {
  // Access gate: shown ONCE per 24h to a locked subscriber when they try to
  // send media. Server still rejects the message; this template gives them a
  // way back via the Mini App. Subsequent retries within 24h are silent.
  templateText:
    "Сейчас сообщение не дошло до тренера.\n" +
    "Доступ к практике закончился, поэтому новые сообщения не передаются.\n\n" +
    "Чтобы продолжить разговор, нужно получить доступ.",
  templateButton: "Оплатить",
  manualBillingButton: "Связаться с админом",
};

const subscription = {
  granted: (days: number, until: string) =>
    `🎁 Тренер активировал подписку на ${days} ${pluralDay(days)}. Активна до ${until}. Записывай голосовые!`,
  reset:
    "Подписка сброшена на пробный период (2 дня). Запиши голосовое — тренер ждёт.",
  lapsed:
    "Подписка приостановлена. Свяжись с админом, чтобы возобновить.",
  frozenNotice: (until: string) =>
    `Заморозка активна до ${until}. Сообщения снова начнут приходить тренеру после неё.`,
  paymentSucceeded: (until: string) =>
    `Спасибо! Подписка активна до ${until}. Запиши голосовое — тренер уже ждёт.`,
  trialEndsTomorrow:
    "Завтра заканчивается пробный период. Чтобы продолжить — открой и оплати подписку.",
  trialEndsToday: "Сегодня последний день пробного периода. Не теряй темп — оплати, пока не остановилось.",
  endsTomorrow: "Завтра заканчивается подписка. Продли, чтобы тренер не пропадал.",
  endsToday: "Сегодня заканчивается подписка. Продли — практика продолжится без перерыва.",
  freezeActivated: (days: number) =>
    `Заморозка включена на ${days} ${pluralDay(days)}.\nПодписка автоматически продлится.`,
  referralCreditApplied: (days: number) =>
    `🎁 Твой друг оплатил подписку — твой доступ продлён на ${days} ${pluralDay(days)}.`,
};

const onboarding = {
  // Step 1: welcome on first /start. Single CTA button.
  step1Welcome:
    "Начни говорить на иврите уже сегодня.\n" +
    "И двигайся шаг за шагом через живую практику.\n" +
    "Без уроков и зубрёжки.",
  step1Button: "Начать",

  // Step 2: Video 1 placeholder (real video coming later — single string swap).
  video1Placeholder:
    "🎬 [Видео 1] Превью появится позже.\n\n" +
    "Самуэль рассказывает, как работает сервис: ты записываешь голосовое " +
    "или видео-кружок — живой тренер отвечает. Это пинг-понг: чтобы " +
    "заговорить, нужен живой ответ и продолжение диалога.",
  step2Button: "Продолжить",

  // Step 3: Video 2 placeholder.
  video2Placeholder:
    "🎬 [Видео 2] Превью появится позже.\n\n" +
    "5 минут практики в день — не копятся, чтобы был ритм каждый день. " +
    "Ошибаться нормально. Тренер ведёт разговор, задаёт темп, не даёт " +
    "выпасть. Цель — постепенно переводить тебя в уверенную речь.",
  step3Button: "Дальше",

  // Step 3.5: name capture (between video2 and the record-CTA). No button —
  // student types their first name in chat, the bot stores it as users.name.
  nameAsk:
    "Как мне к тебе обращаться?\nНапиши имя — короткое, как хочешь.",
  nameTooLong: "Слишком длинно. Попробуй короче (до 50 символов).",
  nameTooShort: "Не понял. Напиши имя одним словом или фразой.",
  nameThanks: (name: string) => `Приятно познакомиться, ${name}!`,

  // Step 4: pure CTA, no button. Student is expected to record voice.
  step4CtaRecord:
    "Запиши голосовое или видео-кружок на иврите.\n" +
    "Расскажи о себе: чем занимаешься или как прошёл день.\n" +
    "Не думай долго — говори как получается.",

  // Step 5: 2h soft nudge.
  step5Nudge2h:
    "Самое сложное — начать.\n" +
    "Скажи хоть что-то.\n" +
    "Даже одно слово, например «шалом».\n" +
    "Дальше станет проще.",

  // Step 6: 24h hard nudge (deferred for quiet hours).
  step6Nudge24h:
    "Если ты сейчас не попробуешь — дальше не сдвинется.\n" +
    "Здесь всё работает только через практику.\n" +
    "Запиши короткое голосовое и попробуй.",

  // Step 8: meta-explainer 5min after first teacher reply.
  step8MetaExplainer:
    "Вот так это и работает: ты говоришь → тренер отвечает → разговор " +
    "продолжается.\nПродолжай, именно в этом моменте появляется речь.",

  // Step 9: day-1 limit hit. Soft "you're done for today" with no CTA.
  step9Day1LimitDone:
    "На сегодня практики более чем достаточно 👍.\nВажно просто вернуться " +
    "завтра и продолжить.",

  // Step 10: day-2+ pause nudge after 6h inactivity.
  step10PauseNudge:
    "Не останавливайся.\nДаже короткие ответы дают результат, если делать " +
    "это каждый день.",

  // Step 11: end of trial → conversion CTA.
  step11Day2Conversion:
    "Пробные 2 дня завершены.\nФормат уже понятен: живой тренер, практика " +
    "каждый день, движение шаг за шагом.\nТеперь главное — не терять темп.",
  step11Button: "Оплатить и продолжить практику",

  // Step 12: survey 1d after trial expiry without payment.
  step12Survey:
    "Привет, на связи Самуэль.\nВижу, ты уже попробовал формат.\n" +
    "Планируешь продолжить?",
  surveyYes: "Да",
  surveyLater: "Позже",
  surveyNo: "Нет",

  // Step 12.1: Yes → "open access".
  step12_1Yes:
    "Отлично.\nТогда можно открыть доступ и вернуться к практике.",
  step12_1Button: "Открыть доступ",

  // Step 12.2: Later → "I'll remind you".
  step12_2Later:
    "Понял.\nТогда напомню позже, чтобы можно было спокойно вернуться.",

  // Step 12.3: No / 5d-after-Later → Video 3 + chat-support button.
  video3Placeholder:
    "🎬 [Видео 3] Превью появится позже.\n\n" +
    "Привет, на связи снова Самуэль. Если есть пара минут — скажи, что " +
    "именно не зашло или чего не хватило. Можно коротко: текстом или " +
    "голосом. Когда нажмёшь «Ответить Самуэлю», откроется отдельный чат. " +
    "Сообщения попадут только мне, никто больше их не видит.",
  video3Button: "Ответить Самуэлю",

  // Stale-button reply for callback_query when state has moved on.
  staleButton: "Кнопка устарела",
};

const labels = {
  studentFallback: "Ученик",
  adminFallback: "Админ",
  voiceLower: "голосовое",
  videoNoteLower: "круглое видео",
  voiceUpper: "Голосовое",
  videoNoteUpper: "Круглое видео",
  openInline: "Открыть",
};

const transcripts = {
  // Sent (threaded as reply to the audio) when Gemini Flash transcription
  // failed or timed out. Audio itself was already delivered.
  failureNotice: "Не удалось расшифровать запись.",
  // Prefix for the fallback "edit" message when TG refuses an
  // editMessageText call (e.g. 48h cap) and we send a fresh threaded
  // transcript correction instead.
  correctionPrefix: "📝 Поправка: ",
  // Prefix for the Russian translation that follows the verbatim
  // transcript (sent as a second threaded reply to the audio).
  translationPrefix: "🇷🇺 Перевод: ",
  // Fallback "edit" message for translation (translation editMessageText
  // refused).
  translationCorrectionPrefix: "📝 Поправка перевода: ",
};

const notifications = {
  teacherReplyMissingContext:
    "Чтобы ответить ученику, открой мини-приложение, нажми «Ответить» рядом с его сообщением, и потом свайпни по подсказке.",
  teacherReplyDelivered: "✅ Ответ отправлен ученику.",
  teacherReplyDeliveredWithTranscript: (transcript: string) =>
    `✅ Ответ отправлен ученику.\n\n📝 Расшифровка:\n${transcript}`,
  editTranscriptButton: "Изменить расшифровку",
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
  adminUnassignedPing: (userLabel: string, kindLabel: string) =>
    `📥 ${kindLabel} от ${userLabel} — ученик пока не закреплён ни за одним тренером. Назначь тренера, чтобы ответ пошёл.`,
  userFeedbackReplyPing:
    "💬 Новый ответ от админа. Открой обратную связь, чтобы прочитать и ответить.",
  teacherNotificationActionable: (studentName: string, kindLabel: string, durationLabel: string) =>
    `🔔 Новое: ${kindLabel} ${durationLabel} от ${studentName}. Открой мини-приложение, чтобы взять в работу.`,
  teacherNotificationTaken: (handler: string, studentHandle: string) =>
    `✓ ${studentHandle}: в работе у ${handler}.`,
  teacherNotificationExpired: "⚠️ Время на ответ истекло, сообщение снова доступно.",
};

export const bot = {
  greetings,
  invites,
  access,
  quota,
  locked,
  subscription,
  onboarding,
  notifications,
  labels,
  transcripts,
};
