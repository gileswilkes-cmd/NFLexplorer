export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center font-sans">
      <h1 className="text-4xl font-semibold tracking-tight">NFL Explorer</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Players · Teams · Comparisons · History — 2015–2025
      </p>
      <p className="text-sm text-zinc-400 dark:text-zinc-500">
        Phase 0: scaffolding. Player pages arrive in Phase 1.
      </p>
    </main>
  );
}
