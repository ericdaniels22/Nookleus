import type { ReactNode } from "react";

interface BuilderLayoutProps {
  children: ReactNode;
  /** Right-side editor panel. Reserved this slice — content arrives later. */
  editorSlot?: ReactNode;
  /** Bottom totals bar. Reserved this slice — content arrives later. */
  totalsSlot?: ReactNode;
  /**
   * #544: fires when the document surface is clicked. The Estimate Builder uses
   * this to clear the editor selection on an empty-space click. Rows stop
   * propagation, so clicking a row selects it instead of bubbling here. The
   * editor panel lives in a sibling <aside>, so clicks inside it never reach
   * this handler.
   */
  onBackgroundClick?: () => void;
}

export function BuilderLayout({
  children,
  editorSlot,
  totalsSlot,
  onBackgroundClick,
}: BuilderLayoutProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <main
          data-testid="builder-document"
          onClick={onBackgroundClick}
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
