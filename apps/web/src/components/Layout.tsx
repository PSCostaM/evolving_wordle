// Page frame: sticky lab header with a status slot, a responsive container,
// and a small footer.

import { ReactNode } from 'react';

export function Layout({
  status,
  children,
}: {
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-lab-border/70 bg-lab-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan to-neon-purple text-sm font-black text-slate-950">
              W
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight">Wordle Evolution Lab</div>
              <div className="text-[11px] text-lab-muted">genetic algorithm · no neural nets</div>
            </div>
          </div>
          <div className="flex items-center gap-2">{status}</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-center text-xs text-lab-muted">
        Built with a heuristic Wordle player evolved by a genetic algorithm · deterministic &amp;
        seeded · runs entirely in your browser.
      </footer>
    </div>
  );
}
