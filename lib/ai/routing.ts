import { LLMError } from "./llm";

/**
 * Deterministic model routing. Three logical capabilities map onto configured
 * model names; every one falls back to LLM_MODEL when unset.
 *
 * Rules:
 * - image-bearing requests → "vision" (never silently downgraded to fast)
 * - explicit "reasoning" capability → reasoning model (503 if not configured)
 * - everything else → "fast"
 * No LLM classifier, no automatic escalation, no retries added by routing.
 */

export type ModelCapability = "fast" | "vision" | "reasoning";

export type ModelRoutes = {
  fast: string;
  vision?: string;
  reasoning?: string;
};

export function readRoutes(env: Record<string, string | undefined>, fallback: string): ModelRoutes {
  return {
    fast: env.LLM_FAST_MODEL?.trim() || fallback,
    vision: env.LLM_VISION_MODEL?.trim() || undefined,
    reasoning: env.LLM_REASONING_MODEL?.trim() || undefined,
  };
}

export function resolveModel(
  routes: ModelRoutes,
  opts: { hasImage: boolean; capability?: ModelCapability }
): { capability: ModelCapability; model: string } {
  if (opts.hasImage || opts.capability === "vision") {
    if (!routes.vision)
      throw new LLMError("No vision model configured (set LLM_VISION_MODEL)", 503);
    return { capability: "vision", model: routes.vision };
  }
  if (opts.capability === "reasoning") {
    if (!routes.reasoning)
      throw new LLMError("No reasoning model configured (set LLM_REASONING_MODEL)", 503);
    return { capability: "reasoning", model: routes.reasoning };
  }
  return { capability: "fast", model: routes.fast };
}
