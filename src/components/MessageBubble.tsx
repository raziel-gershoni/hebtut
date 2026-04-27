"use client";

type Msg = {
  id: number;
  direction: "in" | "out";
  kind: "voice" | "video_note";
  duration: number;
  created_at: string;
};

export function MessageBubble({ msg, jwt }: { msg: Msg; jwt: string }) {
  const min = Math.floor(msg.duration / 60);
  const sec = (msg.duration % 60).toString().padStart(2, "0");
  const isIn = msg.direction === "in";
  const align = isIn ? "justify-start" : "justify-end";
  const bubbleBase =
    "max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 my-1 transition-colors animate-fade-in";
  const bubble = isIn
    ? "bg-tg-bg-secondary border-l-2 border-tg-text-accent/40"
    : "bg-tg-button/10 border-r-2 border-tg-button/60";
  const src = `/api/media/${msg.id}?token=${encodeURIComponent(jwt)}`;
  const time = new Date(msg.created_at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${align}`}>
      <div className={`${bubbleBase} ${bubble}`}>
        <div className="text-[11px] uppercase tracking-wider text-tg-text-hint mb-1.5 flex items-center gap-2">
          <span>{isIn ? "Ученик" : "Преподаватель"}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {min}:{sec}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{time}</span>
        </div>
        {msg.kind === "voice" ? (
          <audio controls preload="none" src={src} className="w-full" />
        ) : (
          <video
            controls
            preload="none"
            playsInline
            className="rounded-xl max-w-full"
            src={src}
          />
        )}
      </div>
    </div>
  );
}
