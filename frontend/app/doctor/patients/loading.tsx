import { Skeleton } from "@/components/ui";

export default function PatientsLoading() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="h-16 border-b border-line flex items-center px-6 md:px-10">
        <Skeleton className="h-6 w-28" />
      </div>

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-56" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>

        {/* Mirrors the table shown on sm+ screens */}
        <div className="hidden sm:block rounded-xl border border-line bg-white overflow-hidden">
          <div className="grid grid-cols-5 gap-4 px-5 py-3 border-b border-line bg-paper">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
          {Array.from({ length: 7 }).map((_, row) => (
            <div key={row} className="grid grid-cols-5 gap-4 px-5 py-4 border-b border-line last:border-0">
              {Array.from({ length: 5 }).map((_, col) => (
                <Skeleton key={col} className={`h-3.5 ${col === 0 ? "w-28" : "w-16"}`} />
              ))}
            </div>
          ))}
        </div>

        {/* Mirrors the card list shown on small screens */}
        <div className="grid sm:hidden gap-4">
          {Array.from({ length: 4 }).map((_, row) => (
            <div key={row} className="rounded-xl border border-line bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-10 rounded-full" />
              </div>
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
