// PRD #368 — Phone demo / dev mode. Slice 15a (#370).
//
// A pure, deterministic, no-I/O `TwilioClientLike` implementation so the
// already-shipped outbound + number-management surface can run with no
// carrier and no Twilio credentials. `createTwilioClient()` returns this
// when `NOOKLEUS_PHONE_DEMO_MODE === 'true'`; the production fail-safe
// (the throw in that factory) prevents this fake from ever being used in
// production where it would silently swallow a real customer's SMS.

import type { TwilioClientLike } from "./twilio-client";

let smCounter = 0;
let pnCounter = 0;

// Three synthetic locality/region pairs cycled through for the inventory.
// Believable enough for a demo without leaning on any particular real
// market — the area code from the caller is woven into each phoneNumber
// so the picker UI reflects the user's search.
const FAKE_LOCALES: Array<{ locality: string; region: string }> = [
  { locality: "Austin", region: "TX" },
  { locality: "Brooklyn", region: "NY" },
  { locality: "Portland", region: "OR" },
];

function buildFakeLocalInventory(areaCode: string): Array<{
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}> {
  return FAKE_LOCALES.map((entry, i) => {
    // Pad to a 7-digit subscriber number so the resulting +1XXX-XXX-XXXX
    // is well-formed E.164 even when `i` is small.
    const sub = String(5550100 + i).padStart(7, "0");
    const phoneNumber = `+1${areaCode}${sub}`;
    const friendlyName = `(${areaCode}) ${sub.slice(0, 3)}-${sub.slice(3)}`;
    return { phoneNumber, friendlyName, locality: entry.locality, region: entry.region };
  });
}

export function createFakeTwilioClient(): TwilioClientLike {
  return {
    availablePhoneNumbers: () => ({
      local: {
        list: async (opts: { areaCode: string; limit?: number }) =>
          buildFakeLocalInventory(opts.areaCode),
      },
    }),
    incomingPhoneNumbers: Object.assign(
      (_sid: string) => ({ remove: async () => undefined }),
      {
        create: async (opts: { phoneNumber: string }) => {
          pnCounter += 1;
          return { sid: `PN${pnCounter}`, phoneNumber: opts.phoneNumber };
        },
      },
    ),
    messages: {
      create: async () => {
        smCounter += 1;
        return { sid: `SM${smCounter}`, status: "queued" };
      },
    },
  };
}
