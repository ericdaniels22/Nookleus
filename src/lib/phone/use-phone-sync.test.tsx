// Regression test for the Job-page production crash (2026-06-10): the Job
// page mounts TWO usePhoneSync consumers for the same org — Messages (N)
// (slice 7, #311) and Calls (N) (slice 12, #316/#620). RealtimeClient dedupes
// channels by topic, so when both hooks named their channel
// `phone-messages-${organizationId}`, the second mount got back the first
// mount's already-subscribed channel instance — and realtime-js (2.101.x)
// THROWS from `.on("postgres_changes", …)` once a channel is joining/joined:
//   "cannot add `postgres_changes` callbacks for … after `subscribe()`."
// The throw escaped the hook's effect into the route error boundary and took
// down every Job page for every view_phone user.
//
// The existing section tests never caught this because they mock usePhoneSync
// itself; this test deliberately uses the REAL hook and the REAL realtime-js
// channel machinery (only the WebSocket transport is a no-network stand-in;
// the bug fires synchronously in `.on()` before any I/O).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usePhoneSync } from "./use-phone-sync";

// Minimal constructible transport: the connection never opens, which is fine
// because subscribe() marks the channel "joining" synchronously and that
// state alone is what triggered the production throw.
class FakeWebSocket {
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  readyState = 0;
  constructor(public url: string) {}
  send() {}
  close() {}
}

function makeRealtimeClient(): SupabaseClient {
  return createClient("http://localhost:54321", "test-anon-key", {
    realtime: { transport: FakeWebSocket as unknown as new (url: string) => WebSocket },
  });
}

// Shaped like JobMessagesSection's subscription (message insert + update).
function MessagesLikeConsumer({ supabase }: { supabase: SupabaseClient }) {
  usePhoneSync({
    supabase,
    organizationId: "org-1",
    onNewMessage: () => {},
    onMessageUpdate: () => {},
  });
  return null;
}

// Shaped like JobCallsSection's subscription (calls + voicemail callbacks).
function CallsLikeConsumer({ supabase }: { supabase: SupabaseClient }) {
  usePhoneSync({
    supabase,
    organizationId: "org-1",
    onNewMessage: () => {},
    onNewCall: () => {},
    onCallUpdate: () => {},
    onVoicemailUpdate: () => {},
  });
  return null;
}

describe("usePhoneSync", () => {
  it("two consumers for the same org can mount on one page (Job page: Messages + Calls)", () => {
    const supabase = makeRealtimeClient();
    expect(() =>
      render(
        <>
          <MessagesLikeConsumer supabase={supabase} />
          <CallsLikeConsumer supabase={supabase} />
        </>,
      ),
    ).not.toThrow();
  });

  it("a consumer can mount after an earlier one already subscribed", () => {
    const supabase = makeRealtimeClient();
    const first = render(<MessagesLikeConsumer supabase={supabase} />);
    expect(() =>
      render(<CallsLikeConsumer supabase={supabase} />),
    ).not.toThrow();
    first.unmount();
  });
});
