"use client";

import type { MenuItem } from "./menuModel";

/**
 * Shared row renderer for the desktop dropdowns and the mobile sheet.
 * `onAction` runs after any action item so the container can close itself.
 */
export default function MenuList({ items, onAction }: { items: MenuItem[]; onAction: () => void }) {
  return (
    <>
      {items.map((item) => {
        if (item.type === "divider") {
          return <div key={item.id} role="separator" className="mx-3 my-1 h-px bg-white/10" />;
        }
        if (item.type === "note") {
          return (
            <div key={item.id} role="none" className="flex items-baseline gap-2 px-3 py-1 text-[12px] text-neutral-400">
              <span className="shrink-0 font-medium text-neutral-300">{item.label}</span>
              {item.text && <span className="min-w-0 flex-1">{item.text}</span>}
            </div>
          );
        }
        const isCheck = item.checked !== undefined;
        return (
          <button
            key={item.id}
            type="button"
            role={isCheck ? "menuitemcheckbox" : "menuitem"}
            aria-checked={isCheck ? item.checked : undefined}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onAction();
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors
              hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-40
              ${item.danger ? "text-red-300" : "text-neutral-100"}`}
          >
            <span className="w-4 shrink-0 text-center text-green-300" aria-hidden>
              {isCheck && item.checked ? "✓" : ""}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="shrink-0 text-[11px] text-neutral-400">{item.shortcut}</span>}
          </button>
        );
      })}
    </>
  );
}
