import type { CompanySettings, Contact, Job } from "./types";

export type LogoVariant =
  | { kind: "image"; path: string }
  | { kind: "text"; name: string };

export interface PointOfContact {
  companyName: string;
  phone: string | null;
  email: string | null;
}

export interface InsuranceBlock {
  visible: boolean;
  carrier: string;
  claimNumber: string;
}

export interface CoverPageData {
  logo: LogoVariant;
  customerName: string;
  propertyAddress: string;
  pointOfContact: PointOfContact;
  insurance: InsuranceBlock;
}

// Structural subset — accepts a full Job or a partial Supabase-joined row.
export type CoverPageJob = {
  property_address: Job["property_address"];
  insurance_company: Job["insurance_company"];
  claim_number: Job["claim_number"];
  contact?: Pick<Contact, "full_name"> | null;
};

export function resolveCoverPageData(
  job: CoverPageJob,
  companySettings: CompanySettings,
): CoverPageData {
  const carrier = job.insurance_company?.trim() ?? "";
  const claimNumber = job.claim_number?.trim() ?? "";
  const insuranceVisible = carrier !== "" || claimNumber !== "";

  const logoPath = companySettings.logo_path?.trim() ?? "";
  const logo: LogoVariant =
    logoPath !== ""
      ? { kind: "image", path: logoPath }
      : { kind: "text", name: companySettings.company_name ?? "" };

  const phone = companySettings.phone?.trim() ?? "";
  const email = companySettings.email?.trim() ?? "";

  return {
    logo,
    customerName: job.contact?.full_name ?? "",
    propertyAddress: job.property_address ?? "",
    pointOfContact: {
      companyName: companySettings.company_name ?? "",
      phone: phone !== "" ? phone : null,
      email: email !== "" ? email : null,
    },
    insurance: {
      visible: insuranceVisible,
      carrier,
      claimNumber,
    },
  };
}
