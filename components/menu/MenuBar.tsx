"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuSection } from "./menuModel";
import MenuList from "./MenuList";

const ITEM_SEL = "[role^=menuitem]:not([disabled])";

/**
 * Desktop app menubar (File / View / Settings / Help). Dark-glass dropdowns
 * so the translucency reads over the white page. Keyboard model follows a
 * classic menubar: arrows move within and between menus, Enter activates,
 * Esc closes and returns focus to the trigger. Hidden below `sm` — the
 * mobile sheet replaces it.
 */
export default function MenuBar({ menus }: { menus: MenuSection[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Click/tap anywhere outside closes the open menu.
  useEffect(() => {
    if (open === null) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  // Move focus to the first actionable item when a menu opens.
  useEffect(() => {
    if (open === null) return;
    listRef.current?.querySelector<HTMLElement>(ITEM_SEL)?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (open !== null) {
        e.stopPropagation();
        setOpen(null);
        btnRefs.current[open]?.focus();
      }
      return;
    }
    if (open === null) return;
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>(ITEM_SEL) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setOpen((open + 1) % menus.length);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setOpen((open - 1 + menus.length) % menus.length);
    } else if (e.key === "Tab") {
      setOpen(null);
    }
  };

  return (
    <nav ref={rootRef} aria-label="App menu" className="hidden items-center sm:flex" onKeyDown={onKeyDown}>
      {menus.map((m, i) => (
        <div key={m.id} className="relative">
          <button
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => {
              if (open !== null && open !== i) setOpen(i);
            }}
            className={`flex h-9 items-center rounded-md px-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600
              ${open === i ? "bg-neutral-200/70 text-neutral-900" : "text-neutral-700 hover:bg-neutral-200/70"}`}
          >
            {m.label}
          </button>
          {open === i && (
            <div
              ref={listRef}
              role="menu"
              aria-label={m.label}
              className="menu-pop absolute left-0 top-full z-50 mt-1 min-w-60 rounded-xl border border-white/10 bg-neutral-900/90 p-1.5 text-neutral-100 shadow-2xl backdrop-blur-xl"
            >
              <MenuList items={m.items} onAction={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
