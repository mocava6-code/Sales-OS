import type { ObservationType } from "@/server/intelligence/observation/types";

export function NeverObservedList({ types }: { types: ObservationType[] }) {
  if (types.length === 0) return null;

  return (
    <div data-testid="never-observed-list">
      <h2 className="text-sm font-medium text-neutral-500">Never observed</h2>
      <ul className="mt-1 space-y-1 text-sm text-neutral-700">
        {types.map((type) => (
          <li key={type}>{type}</li>
        ))}
      </ul>
    </div>
  );
}
