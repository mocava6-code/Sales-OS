import { LeadForm } from "@/components/leads/LeadForm";

export default function NewLeadPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Nuevo cliente</h1>
      <LeadForm />
    </div>
  );
}
