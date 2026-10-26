/**
 * Menu item tree shared by the desktop menubar (MenuBar) and the mobile
 * bottom sheet (MobileSheet). NotebookApp builds the tree each render so
 * `checked`/`disabled` always reflect live state; both views render the
 * same items.
 */
export type MenuItem =
  | {
      type: "action";
      id: string;
      label: string;
      /** Right-aligned hint text, e.g. "Ctrl+Z". */
      shortcut?: string;
      /** When defined the row renders as a checkbox item (✓ when true). */
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | { type: "divider"; id: string }
  /** Non-interactive row: label plus small helper text (Help/Settings info). */
  | { type: "note"; id: string; label: string; text?: string };

export type MenuSection = { id: string; label: string; items: MenuItem[] };
