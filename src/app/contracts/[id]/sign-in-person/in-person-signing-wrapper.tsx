"use client";

import { useRouter } from "next/navigation";
import ContractSignerView from "@/components/contracts/contract-signer-view";
import type { PublicSigningView } from "@/lib/contracts/types";

interface Props {
  view: PublicSigningView;
  contractId: string;
}

export default function InPersonSigningWrapper({ view, contractId }: Props) {
  const router = useRouter();

  function handleSigned() {
    router.push(`/contracts/${contractId}/sign-in-person/complete`);
  }

  return (
    <ContractSignerView
      view={view}
      signToken=""
      inPerson={true}
      onSigned={handleSigned}
    />
  );
}
