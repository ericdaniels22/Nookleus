import { Extension } from "@tiptap/core";

export interface SendShortcutOptions {
  /** Invoked when the user presses the send chord (Cmd/Ctrl+Enter) in the body. */
  onSend: () => void;
}

/**
 * Sends the compose email when Cmd/Ctrl+Enter is pressed inside the message body
 * (issue #645 / PRD #634). StarterKit's HardBreak binds Mod-Enter to insert a
 * line break; this extension's higher priority wins that chord so it triggers a
 * send instead of dropping a stray <br> into the message. Header fields
 * (To/Cc/Bcc/Subject) live outside the editor and route the same chord through
 * the pure isSendShortcut module via a form-level handler, so the chord works
 * from anywhere in compose.
 *
 * Opt-in: only the compose editor loads this via TiptapEditor's extraExtensions,
 * so the shared editor's other consumers keep HardBreak's default Mod-Enter.
 */
export const SendShortcutExtension = Extension.create<SendShortcutOptions>({
  name: "composeSendShortcut",
  // Beat StarterKit's HardBreak (default priority 100) so Mod-Enter sends.
  priority: 1000,

  addOptions() {
    return { onSend: () => {} };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        this.options.onSend();
        return true;
      },
    };
  },
});
