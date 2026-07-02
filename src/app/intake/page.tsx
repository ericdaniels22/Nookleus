import IntakeForm from "@/components/intake-form";
import PageHeader from "@/components/page-header";

export default function IntakePage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New customer intake"
        subtitle="Log a new customer call and create a job."
      />
      <IntakeForm />
    </div>
  );
}
