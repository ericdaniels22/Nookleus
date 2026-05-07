"use client";

// TEMP DEBUG (revert me): bisect 3 — re-enable the real wrapper but with
// imports limited to ContractSignerView. Bisect 1 proved the page renders
// without this. Bisect 2 proved a stub wrapper renders. So the failure is
// inside ContractSignerView's import chain (PdfCanvas / SignaturePadModal).
import { useRouter } from "next/navigation";
import ContractSignerView from "@/components/contracts/contract-signer-view";
import type { PublicSigningView } from "@/lib/contracts/types";

interface Props {
  view: PublicSigningView;
  signToken: string;
}

export default function SignedRedirectWrapper({ view, signToken }: Props) {
  const router = useRouter();
  function handleSigned() {
    router.refresh();
  }
  return (
    <ContractSignerView
      view={view}
      signToken={signToken}
      onSigned={handleSigned}
    />
  );
}
