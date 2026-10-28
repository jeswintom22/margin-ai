import type { Metadata } from "next";
import EditorApp from "@/components/editor/EditorApp";
import ErrorBoundary from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Margin v2 — Notebook (preview)",
};

export default function V2Page() {
  return (
    <ErrorBoundary>
      <EditorApp />
    </ErrorBoundary>
  );
}
