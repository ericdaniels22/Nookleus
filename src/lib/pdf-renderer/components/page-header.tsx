import { View, Text, Image } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";

interface Props { documentTitle: string; logoUrl: string | null; }

export function PageHeader({ documentTitle, logoUrl }: Props) {
  return (
    <View style={styles.header}>
      <Text style={styles.docTitle}>{documentTitle}</Text>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
    </View>
  );
}
