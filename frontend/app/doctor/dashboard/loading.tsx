import { Skeleton } from "@/components/ui";

// Next renders this automatically while DoctorDashboardPage's serverFetch
// calls (/api/me, /api/patients) are in flight — shaped to match the real
// layout below so the page doesn't visually "jump" once data arrives.
export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="h-16 border-b border-line flex items-center px-6 md:px-10">
        <Skeleton className="h-6 w-28" />
      </div>

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-64" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>

        <div className="max-w-xl mb-12">
          <Skeleton className="h-11 w-full" />
        </div>

        <Skeleton className="h-3 w-40 mb-3" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-line bg-white space-y-3">
              <div className="flex items-start justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
