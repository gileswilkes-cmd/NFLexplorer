import PlayerSearch from "@/components/PlayerSearch";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-6 px-6 pt-24 pb-16">
      <h1 className="text-4xl font-semibold tracking-tight">NFL Explorer</h1>
      <p className="text-ink-secondary">
        Players · 2015–2025 · every number in league context
      </p>
      <PlayerSearch autoFocus />
      <p className="text-sm text-ink-muted">
        Try “Mahomes”, “Kelce”, or any player active since 2015.
      </p>
    </main>
  );
}
