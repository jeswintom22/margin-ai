import { PAGE_SIZES } from "./units";
import { SCHEMA_VERSION, type Layer, type LayerAuthor, type Notebook, type Page, type PageTemplate } from "./types";

let counter = 0;
/** Unique id: time + counter + random suffix (no crypto dependency). */
export function newId(): string {
  counter = (counter + 1) % 0xffff;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_TEMPLATE: PageTemplate = {
  ...PAGE_SIZES.A4,
  background: { kind: "solid", style: "lined", color: "#ffffff" },
};

export function createLayer(name: string, author: LayerAuthor = "user"): Layer {
  return { id: newId(), name, visible: true, author, elements: [] };
}

export function createPage(template: PageTemplate = DEFAULT_TEMPLATE): Page {
  return {
    id: newId(),
    width: template.width,
    height: template.height,
    background: { ...template.background },
    layers: [createLayer("Layer 1")],
  };
}

export function createNotebook(title: string, template: PageTemplate = DEFAULT_TEMPLATE): Notebook {
  const now = Date.now();
  return { id: newId(), title, schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, pages: [createPage(template)] };
}

/**
 * Deterministic stand-in used before storage has loaded. No clock or random
 * ids: it may be rendered during server prerendering (cacheComponents).
 */
export function placeholderNotebook(): Notebook {
  return {
    id: "placeholder",
    title: "Loading…",
    schemaVersion: SCHEMA_VERSION,
    createdAt: 0,
    updatedAt: 0,
    pages: [{ id: "placeholder-page", ...PAGE_SIZES.A4, background: { ...DEFAULT_TEMPLATE.background }, layers: [{ id: "placeholder-layer", name: "Layer 1", visible: true, author: "user", elements: [] }] }],
  };
}

/** Template describing an existing page (used for "insert page like this one"). */
export function templateOf(page: Page): PageTemplate {
  return {
    width: page.width,
    height: page.height,
    background: page.background.kind === "solid" ? { ...page.background } : { ...DEFAULT_TEMPLATE.background },
  };
}

/** Topmost visible user layer (tools draw here), creating one if none exists. */
export function drawLayer(page: Page, preferredId?: string | null): Layer {
  const pref = preferredId ? page.layers.find((l) => l.id === preferredId && l.author === "user") : undefined;
  if (pref) return pref;
  for (let i = page.layers.length - 1; i >= 0; i--) if (page.layers[i].author === "user") return page.layers[i];
  const l = createLayer("Layer 1");
  page.layers.unshift(l);
  return l;
}

/** Deep-ish clone of a page with fresh ids (duplicate page). */
export function clonePage(page: Page): Page {
  return {
    ...structuredClone(page),
    id: newId(),
    layers: page.layers.map((l) => ({
      ...structuredClone(l),
      id: newId(),
      elements: l.elements.map((e) => ({ ...structuredClone(e), id: newId() })),
    })),
  };
}
