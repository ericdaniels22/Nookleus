import { View, Text } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";

interface Props { jobNumber: string; }

export function PageFooter({ jobNumber }: Props) {
  return (
    <View style={styles.footer} fixed>
      <Text>Job {jobNumber}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
