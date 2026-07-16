export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mb-4 text-4xl">🚧</div>
      <h1 className="mb-2 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="text-slate-600 dark:text-slate-400">{children}</p>
    </div>
  );
}
