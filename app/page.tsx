import NotebookApp from "@/components/notebook/NotebookApp";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function Home() {
  return (
    <ErrorBoundary>
      <NotebookApp />
    </ErrorBoundary>
  );
}
