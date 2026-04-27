"use client";
import type { ReactNode } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fade-in">
      <div className="bg-tg-bg-section text-tg-text w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-slide-up">
        <h2 className="font-semibold tracking-tight mb-2">{title}</h2>
        <div className="text-sm text-tg-text-subtitle mb-5">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 h-10 px-4 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium transition-transform active:scale-95"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-10 h-10 px-4 rounded-full bg-tg-text-destructive text-white text-sm font-medium transition-transform active:scale-95"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}
