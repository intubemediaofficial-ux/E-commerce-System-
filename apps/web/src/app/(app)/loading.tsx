export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="card h-24 animate-pulse bg-slate-100" />
        ))}
      </div>
      <div className="card h-72 animate-pulse bg-slate-100" />
    </div>
  );
}
