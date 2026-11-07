"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Dialog({
  open, onOpenChange, title, description, children, size = "md",
}: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; size?: "sm" | "md" | "lg" }) {
  const w = { sm: "sm:max-w-[400px]", md: "sm:max-w-[520px]", lg: "sm:max-w-[720px]" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-[fade_var(--t-motion-base)_var(--t-motion-ease)]" />
        <D.Content
          className={`fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full ${w} max-h-[90dvh] overflow-y-auto bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-pop p-6 focus:outline-none data-[state=open]:animate-[rise_var(--t-motion-base)_var(--t-motion-ease)]`}
        >
          <div className="flex items-start justify-between gap-4">
            <D.Title className="text-lg">{title}</D.Title>
            <D.Close className="size-10 -mr-2 -mt-2 grid place-items-center rounded-md hover:bg-surface-hover" aria-label="Close">
              <X className="size-5" aria-hidden />
            </D.Close>
          </div>
          {description ? <D.Description className="text-sm text-text-muted mt-1">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          <div className="mt-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
