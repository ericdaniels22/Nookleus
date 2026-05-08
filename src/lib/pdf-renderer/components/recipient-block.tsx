import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import type { PdfRecipient } from "@/lib/pdf-renderer/types";

interface Props { recipient: PdfRecipient; }

export function RecipientBlock({ recipient }: Props) {
  return (
    <View style={styles.col}>
      <Text style={styles.h}>To</Text>
      <Text>{recipient.name}</Text>
      {recipient.property_address ? (
        <Text style={styles.muted}>{recipient.property_address}</Text>
      ) : null}
      {recipient.phone ? <Text style={styles.muted}>{recipient.phone}</Text> : null}
      {recipient.email ? <Text style={styles.muted}>{recipient.email}</Text> : null}
    </View>
  );
}
