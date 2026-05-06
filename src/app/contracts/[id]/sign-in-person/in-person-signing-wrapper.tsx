"use client";

import { usePathname, useRouter } from "next/navigation";
import ContractSignerView from "@/components/contracts/contract-signer-view";
import type { PublicSigningView } from "@/lib/contracts/types";

interface Props {
  view: PublicSigningView;
}

export default function InPersonSigningWrapper({ view }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function handleSigned(result: { all_signed: boolean }) {
    if (result.all_signed) {
      router.push(`${pathname}/complete`);
    } else {
      // Reload the SSR page so the next unsigned signer is picked up
      // and pre-filled into the view.
      router.refresh();
    }
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
