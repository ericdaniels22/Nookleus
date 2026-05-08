"use client";

import dynamic from "next/dynamic";

const SignedPdfViewer = dynamic(
  () => import("@/components/contracts/signed-pdf-viewer"),
  { ssr: false },
);

interface Props {
  pdfUrl: string;
}

export default function SignedPdfViewerClient({ pdfUrl }: Props) {
  return <SignedPdfViewer pdfUrl={pdfUrl} />;
}
