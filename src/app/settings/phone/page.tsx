"use client";

import { PhoneNumbersTab } from "./phone-numbers-tab";

// PRD #304 — Nookleus Phone. Slice 3 (#307).
//
// Settings → Phone. Slice 3 lands one tab (Numbers). Slice 5 will likely
// add an Opt-outs tab and slice 8 an Inbound rules editor; the tab shell
// from /settings/email is already the template if/when that happens.

export default function PhoneSettingsPage() {
  return <PhoneNumbersTab />;
}
