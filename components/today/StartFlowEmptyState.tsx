import { Card } from "@/components/ui/Card";

export function StartFlowEmptyState() {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">Start</h2>
      <Card className="text-sm text-neutral-500">
        The guided walkthrough of today&apos;s actions isn&apos;t built yet — for now, work
        through the list above manually.
      </Card>
    </section>
  );
}
