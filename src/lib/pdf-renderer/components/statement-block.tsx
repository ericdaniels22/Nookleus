import { View } from "@react-pdf/renderer";
import { styles } from "@/lib/pdf-renderer/styles";
import { htmlToPdfNodes } from "@/lib/pdf-renderer/html-to-pdf";

interface Props { html: string | null | undefined; }

export function StatementBlock({ html }: Props) {
  const nodes = htmlToPdfNodes(html);
  if (nodes.length === 0) return null;
  return <View style={styles.statementBlock}>{nodes}</View>;
}
