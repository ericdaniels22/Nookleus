// Keyboard-send detection for the compose editor (issue #645 / PRD #634).
// Cmd/Ctrl+Enter sends the email from anywhere in compose. Kept pure and free of
// React/Tiptap so the modifier logic can be unit-tested in isolation, mirroring
// the sibling compose-indent module. The thin shells — a form-level onKeyDown for
// the header fields and an opt-in Tiptap shortcut for the body — both defer the
// "is this the send chord?" decision to this one function.

/** The subset of a keyboard event this decision needs. */
export interface SendShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** True when the event is the send chord: Enter held with Cmd (⌘, macOS) or
 *  Ctrl (Windows/Linux). Plain Enter is left alone so it still inserts
 *  newlines in the editor and submits nothing on its own. */
export function isSendShortcut(e: SendShortcutEvent): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}
