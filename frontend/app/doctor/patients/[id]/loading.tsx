import { Skeleton } from "@/components/ui";

export default function PatientDetailLoading() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="h-16 border-b border-line flex items-center px-6 md:px-10">
        <Skeleton className="h-6 w-28" />
      </div>

      <div className="max-w-6xl mx-auto px-6 md:px-10 pt-10 pb-4 flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-44" />
      </div>

      <div className="max-w-6xl mx-auto px-6 md:px-10 pb-10 grid lg:grid-cols-[320px_1fr] gap-8">
        <aside className="space-y-6">
          <div className="p-5 rounded-xl border border-line bg-white space-y-4">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-3 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-14 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="space-y-3 pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-3.5 w-full" />
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-5 rounded-xl border border-line bg-white space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
