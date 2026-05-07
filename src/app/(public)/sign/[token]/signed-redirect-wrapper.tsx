"use client";

// TEMP DEBUG (revert me): bisecting SC→CC SSR 500. The original content is:
//   import { useRouter } from "next/navigation";
//   import ContractSignerView from "@/components/contracts/contract-signer-view";
//   ...renders <ContractSignerView view={view} signToken={signToken} onSigned={handleSigned}/>
// Stubbed below to a plain div with no extra imports. If this 500s, the
// problem is the wrapper module itself / SC→CC handshake. If 200, the
// problem is in ContractSignerView (or PdfCanvas/SignaturePadModal beneath it).
import type { PublicSigningView } from "@/lib/contracts/types";

interface Props {
  view: PublicSigningView;
  signToken: string;
}

export default function SignedRedirectWrapper({ view, signToken }: Props) {
  return (
    <div style={{ padding: "1rem", border: "2px solid #d4d4d8", borderRadius: 8, fontSize: 12 }}>
      SIGN-PAGE-DEBUG (stub wrapper) view-title={view.contract.title} signToken-len={signToken.length}
    </div>
  );
}
