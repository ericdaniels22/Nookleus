"use client";

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
    // Re-fetch the SSR page so it picks up the latest contract status.
    // If everyone has signed, the SSR page will render <SignedShell>; if
    // there's still an unsigned co-signer, the page renders the next
    // signer's context (matching email-link reuse semantics).
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
