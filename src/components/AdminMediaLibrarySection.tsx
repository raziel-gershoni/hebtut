"use client";
import { useState } from "react";
import { MediaPicker } from "./MediaPicker";
import { ru } from "@/lib/i18n";

export function AdminMediaLibrarySection({ jwt }: { jwt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-tg-button text-tg-button-text text-sm font-medium transition-transform active:scale-95"
      >
        {ru.admin.mediaLibrary.openButton}
      </button>
      <MediaPicker
        open={open}
        jwt={jwt}
        studentId={null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
