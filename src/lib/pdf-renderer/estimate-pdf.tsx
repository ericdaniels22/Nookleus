// src/lib/pdf-renderer/estimate-pdf.tsx
import { Document, Page, View } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import { PageHeader } from "@/lib/pdf-renderer/components/page-header";
import { CompanyBlock } from "@/lib/pdf-renderer/components/company-block";
import { RecipientBlock } from "@/lib/pdf-renderer/components/recipient-block";
import { DocumentDetails } from "@/lib/pdf-renderer/components/document-details";
import { StatementBlock } from "@/lib/pdf-renderer/components/statement-block";
import { SectionsTable } from "@/lib/pdf-renderer/components/sections-table";
import { TotalsBlock } from "@/lib/pdf-renderer/components/totals-block";
import { PageFooter } from "@/lib/pdf-renderer/components/page-footer";
import type { RenderInput } from "@/lib/pdf-renderer/types";

type Input = Extract<RenderInput, { kind: "estimate" }>;

export function EstimatePdf(input: Input) {
  const { document, sections, lineItems, layout, company, recipient, jobNumber } = input;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <PageHeader
          documentTitle={layout.document_title}
          showDocumentTitle={layout.show_document_title}
          logoUrl={company.logo_url}
        />
        <View style={styles.twoCol}>
          <CompanyBlock company={company} />
          <RecipientBlock recipient={recipient} />
        </View>
        <DocumentDetails document={document} kind="estimate" />
        {layout.show_opening_statement && (
          <StatementBlock html={document.opening_statement} />
        )}
        <SectionsTable sections={sections} lineItems={lineItems} layout={layout} />
        <TotalsBlock document={document} layout={layout} />
        {layout.show_closing_statement && (
          <StatementBlock html={document.closing_statement} />
        )}
        <PageFooter jobNumber={jobNumber} />
      </Page>
    </Document>
  );
}
