import { Card } from "@/components/ui/card";

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800/80 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <header className="space-y-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-80 max-w-full" />
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-3">
            <Bar className="h-4 w-24" />
            <Bar className="h-8 w-32" />
          </Card>
        ))}
      </div>
      <Card className="space-y-3">
        <Bar className="h-4 w-40" />
        <Bar className="h-48 w-full" />
      </Card>
    </div>
  );
}
