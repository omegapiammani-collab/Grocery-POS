'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidthClass?: string;
  closeOnBackdropClick?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidthClass = 'max-w-lg',
  closeOnBackdropClick = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      if (document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
    }
    onClose();
    requestAnimationFrame(() => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    });
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClose={handleClose}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === dialogRef.current) {
          handleClose();
        }
      }}
      className={`m-auto w-[calc(100%-1.5rem)] ${maxWidthClass} rounded-2xl bg-white p-0 text-slate-900 shadow-2xl border border-slate-200 open:flex open:flex-col max-h-[90dvh]`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
        <h2 id={titleId} className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="ปิดหน้าต่าง"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="overflow-y-auto p-5">{open ? children : null}</div>
    </dialog>
  );
}
