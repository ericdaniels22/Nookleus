import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { PdfCompany } from "@/lib/pdf-renderer/types";

interface Props { company: PdfCompany; }

export function CompanyBlock({ company }: Props) {
  return (
    <View style={styles.col}>
      <Text style={styles.h}>From</Text>
      {company.name ? <Text>{company.name}</Text> : null}
      {company.address ? <Text style={styles.muted}>{company.address}</Text> : null}
      {company.phone ? <Text style={styles.muted}>{company.phone}</Text> : null}
      {company.email ? <Text style={styles.muted}>{company.email}</Text> : null}
    </View>
  );
}
