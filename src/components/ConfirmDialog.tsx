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
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white text-black w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 shadow-xl">
        <h2 className="font-semibold mb-2">{title}</h2>
        <div className="text-sm mb-4">{body}</div>
        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded bg-gray-100" onClick={onCancel}>
            Отмена
          </button>
          <button className="px-3 py-2 rounded bg-red-600 text-white" onClick={onConfirm}>
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}
