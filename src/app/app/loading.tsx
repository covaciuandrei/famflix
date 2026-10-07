import { Loader2 } from "lucide-react";

// Shown right away when moving between pages, while the server prepares the next one.
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-1 items-center justify-center py-24 text-muted-foreground"
    >
      <Loader2 className="size-7 animate-spin" />
    </div>
  );
}
