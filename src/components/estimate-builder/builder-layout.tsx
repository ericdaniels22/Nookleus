import type { ReactNode, Ref } from "react";

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
  /**
   * #745: ref to the document surface. Deleting the open line unmounts the editor
   * panel (and its confirm dialog), which would otherwise drop focus to <body>.
   * The builder focuses this stable, still-mounted element instead — so <main>
   * carries tabIndex={-1} to be a programmatic focus target (WCAG 2.4.3).
   */
  documentRef?: Ref<HTMLElement>;
}

export function BuilderLayout({
  children,
  editorSlot,
  totalsSlot,
  onBackgroundClick,
  documentRef,
}: BuilderLayoutProps) {
  return (
    <div className="flex flex-col">
      {/*
        Default `items-stretch` (no `items-start`): the <aside> stretches to the
        document column's full height so the docked editor's `sticky top-6` has
        room to travel and pin while scrolling (#629). With `items-start` the
        aside collapses to content height and the sticky editor scrolls away.
      */}
      <div className="flex flex-col lg:flex-row gap-4">
        <main
          ref={documentRef}
          // tabIndex={-1}: not a Tab stop, but a valid target for the builder's
          // programmatic focus move after a delete (#745). outline-none suppresses
          // the focus ring on this transient, non-keyboard-reachable container.
          tabIndex={-1}
          data-testid="builder-document"
          onClick={onBackgroundClick}
          className="flex-1 min-w-0 px-4 py-6 pb-24 space-y-4 outline-none"
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
