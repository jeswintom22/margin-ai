"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuSection } from "./menuModel";
import MenuList from "./MenuList";

/**
 * Mobile view of the app menu: a bottom sheet (thumb reach) with the same
 * item tree the desktop menubar shows, as collapsible sections. Plain dark
 * scrim — a blurred full-screen overlay over the canvas is too expensive
 * on low-end tablets. Only rendered below `sm`.
 */
export default function MobileSheet({
  menus,
  open,
  onClose,
}: {
  menus: MenuSection[];
  open: boolean;
  onClose: () => void;
}) {
  const [openSection, setOpenSection] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Reset to the first section on close so each open starts at the top.
  const close = () => {
    setOpenSection(0);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenSection(0);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={close}
        tabIndex={-1}
      />
      <div
        ref={sheetRef}
        className="sheet-up absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-neutral-900/90 pb-8 pt-2 text-neutral-100 shadow-2xl backdrop-blur-xl"
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/25" aria-hidden />
        {menus.map((m, i) => {
          const expanded = openSection === i;
          return (
            <section key={m.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenSection(expanded ? -1 : i)}
                className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-semibold focus-visible:bg-white/10 focus-visible:outline-none"
              >
                {m.label}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-4 w-4 text-neutral-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {expanded && (
                <div role="menu" aria-label={m.label} className="px-3 pb-2">
                  <MenuList items={m.items} onAction={close} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
