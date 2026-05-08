import CaptureFlow from "./capture-flow";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CapturePage({ params }: PageProps) {
  const { id } = await params;
  return <CaptureFlow jobId={id} />;
}
