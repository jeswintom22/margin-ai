import { create, all, type MathNode, type EvalFunction } from "mathjs";

/**
 * Restricted mathjs for untrusted expressions (model output, transcriptions).
 * Expressions are parsed, then every node is checked against a whitelist:
 * only numbers, whitelisted variables/constants, arithmetic operators and
 * whitelisted functions are allowed — no assignment, property access,
 * matrices, units, strings, or function definitions.
 */

const math = create(all, {});
const { parse, derivative } = math;

export const MAX_EXPR_LENGTH = 200;
export const ALLOWED_FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
  "sqrt", "cbrt", "abs", "exp", "log", "log10", "log2", "ln",
  "floor", "ceil", "round", "sign", "sec", "csc", "cot",
]);
export const ALLOWED_SYMBOLS = new Set(["x", "y", "t", "u", "n", "a", "b", "c", "pi", "e"]);
const ALLOWED_NODE_TYPES = new Set([
  "ConstantNode", "SymbolNode", "OperatorNode", "ParenthesisNode", "FunctionNode",
]);
const ALLOWED_OPS = new Set(["add", "subtract", "multiply", "divide", "pow", "unaryMinus", "unaryPlus"]);

export class MathInputError extends Error {}

/** Normalize handwriting-ish input: ×, ·, ÷, −, ², ³, ln → log. */
export function normalizeExpr(src: string): string {
  return src
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\bln\(/g, "log(")
    .replace(/\s+/g, " ")
    .trim();
}

function assertSafe(node: MathNode) {
  node.traverse((n) => {
    if (!ALLOWED_NODE_TYPES.has(n.type)) throw new MathInputError(`Unsupported syntax (${n.type})`);
    if (n.type === "ConstantNode" && typeof (n as unknown as { value: unknown }).value !== "number")
      throw new MathInputError("Only numeric constants are allowed");
    if (n.type === "OperatorNode" && !ALLOWED_OPS.has((n as unknown as { fn: string }).fn))
      throw new MathInputError("Unsupported operator");
    if (n.type === "FunctionNode") {
      const name = (n as unknown as { fn: { name?: string } }).fn.name ?? "";
      if (!ALLOWED_FUNCTIONS.has(name)) throw new MathInputError(`Function "${name}" is not allowed`);
    }
  });
  // SymbolNodes that are not function names must be whitelisted variables.
  node.traverse((n, _path, parent) => {
    if (n.type !== "SymbolNode") return;
    const name = (n as unknown as { name: string }).name;
    const isFnName = parent?.type === "FunctionNode" && (parent as unknown as { fn: MathNode }).fn === n;
    if (!isFnName && !ALLOWED_SYMBOLS.has(name)) throw new MathInputError(`Unknown symbol "${name}"`);
  });
}

/** Parse and validate an expression. Throws MathInputError when unsafe/invalid. */
export function safeParse(src: string): MathNode {
  const s = normalizeExpr(src);
  if (!s) throw new MathInputError("Empty expression");
  if (s.length > MAX_EXPR_LENGTH) throw new MathInputError("Expression is too long");
  let node: MathNode;
  try {
    node = parse(s);
  } catch {
    throw new MathInputError("Could not parse the expression");
  }
  assertSafe(node);
  return node;
}

export function safeCompile(src: string): EvalFunction {
  return safeParse(src).compile();
}

/** Symbolic derivative of a safe expression w.r.t. `v`. */
export function safeDerivative(src: string, v = "x"): MathNode {
  return derivative(safeParse(src), v);
}

/** Evaluate to a finite real number, or null (NaN, ±Infinity, complex, errors). */
export function evalReal(fn: EvalFunction, scope: Record<string, number>): number | null {
  try {
    const r: unknown = fn.evaluate({ ...scope });
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}
