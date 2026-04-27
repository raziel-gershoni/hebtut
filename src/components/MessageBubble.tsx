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
  const align = msg.direction === "in" ? "justify-start" : "justify-end";
  const bg = msg.direction === "in" ? "bg-gray-100" : "bg-blue-50";
  const src = `/api/media/${msg.id}?token=${encodeURIComponent(jwt)}`;

  return (
    <div className={`flex ${align}`}>
      <div className={`max-w-[80%] rounded-2xl ${bg} p-3 m-1`}>
        <div className="text-xs text-gray-500 mb-1">
          {msg.direction === "in" ? "Ученик" : "Преподаватель"} • {min}:{sec}
        </div>
        {msg.kind === "voice" ? (
          <audio controls preload="none" src={src} />
        ) : (
          <video controls preload="none" playsInline className="rounded-xl max-w-full" src={src} />
        )}
      </div>
    </div>
  );
}
