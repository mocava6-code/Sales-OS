import { verifySession } from "@/lib/auth/dal";
import { NeverObservedList } from "@/components/observer-console/NeverObservedList";
import { ObservationCatalogTable } from "@/components/observer-console/ObservationCatalogTable";
import { getObserverConsoleReadDependencies } from "@/server/application/composition-root";
import { listObservationCatalog } from "@/server/observer-console/observation-catalog";

export default async function ObserverCatalogPage() {
  const user = await verifySession();
  const catalog = await listObservationCatalog(user.businessId, getObserverConsoleReadDependencies());

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-neutral-900">Observation catalog</h1>
      <ObservationCatalogTable counts={catalog.counts} />
      <NeverObservedList types={catalog.neverObserved} />
    </div>
  );
}
