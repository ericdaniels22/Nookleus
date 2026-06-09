import type { ReactNode } from "react";

interface BuilderLayoutProps {
  children: ReactNode;
  /** Right-side editor panel. Reserved this slice — content arrives later. */
  editorSlot?: ReactNode;
  /** Bottom totals bar. Reserved this slice — content arrives later. */
  totalsSlot?: ReactNode;
}

export function BuilderLayout({
  children,
  editorSlot,
  totalsSlot,
}: BuilderLayoutProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <main
          data-testid="builder-document"
          className="flex-1 min-w-0 px-4 py-6 pb-24 space-y-4"
        >
          {children}
        </main>
        {editorSlot != null && (
          <aside data-testid="builder-editor-panel">{editorSlot}</aside>
        )}
      </div>
      {totalsSlot != null && (
        <div data-testid="builder-totals-bar">{totalsSlot}</div>
      )}
    </div>
  );
}
