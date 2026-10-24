/**
 * Types and limits shared by the assistant panel (client) and /api/ask (server).
 * Contains no secrets, so it is safe to import from client code.
 */

export const MAX_QUESTION_LENGTH = 4000;

export type AskRequest = { question: string };

export type AskResponse = { answer: string } | { error: string };

/**
 * One assistant exchange. The answer is plain text so a later milestone can
 * render it as AI-authored strokes in the page's AI layer.
 */
export type AssistantExchange = {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  createdAt: number;
};

/** Returns an error message, or null when the question is acceptable. */
export function validateQuestion(question: unknown): string | null {
  if (typeof question !== "string" || !question.trim()) return "Question must not be empty";
  if (question.length > MAX_QUESTION_LENGTH)
    return `Question must be at most ${MAX_QUESTION_LENGTH} characters`;
  return null;
}
