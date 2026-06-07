// PRD #304 — Nookleus Phone. Slice 8 (#312) — thread interleave.
//
// Merge a conversation's text messages and voice calls into one
// chronologically-ordered list of tagged items. A call threads on the same
// phone_conversations row as the messages (natural key: phone_number_id +
// outside_e164), so the Phone-tab thread shows calls and texts to the same
// outside number inline.
//
// Pure (no I/O) and generic: messages need only a `sent_at`, calls only a
// `started_at` — the caller's richer row shapes flow through untouched.

export interface ThreadMessageLike {
  sent_at: string;
}

export interface ThreadCallLike {
  started_at: string;
}

export type ThreadItem<M extends ThreadMessageLike, C extends ThreadCallLike> =
  | { kind: "message"; at: number; message: M }
  | { kind: "call"; at: number; call: C };

export function mergeThreadItems<
  M extends ThreadMessageLike,
  C extends ThreadCallLike,
>(messages: M[], calls: C[]): Array<ThreadItem<M, C>> {
  const items: Array<ThreadItem<M, C>> = [
    ...messages.map(
      (message): ThreadItem<M, C> => ({
        kind: "message",
        at: new Date(message.sent_at).getTime(),
        message,
      }),
    ),
    ...calls.map(
      (call): ThreadItem<M, C> => ({
        kind: "call",
        at: new Date(call.started_at).getTime(),
        call,
      }),
    ),
  ];
  return items.sort((a, b) => a.at - b.at);
}
