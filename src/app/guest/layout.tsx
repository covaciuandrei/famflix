/**
 * The shell of a guest's pages: the name and nothing else. A guest has no account, so there is no menu, no link into
 * the app and nothing of the family's beyond the night itself.
 */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center px-4 sm:px-6">
          <span className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">▶</span>
            FamFlix
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-8 sm:px-6 sm:pb-12">{children}</main>
    </div>
  );
}
