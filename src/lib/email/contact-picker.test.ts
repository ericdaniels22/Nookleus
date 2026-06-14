import { describe, expect, it } from "vitest";

import { selectableContacts } from "./contact-picker";

describe("selectableContacts", () => {
  it("excludes a contact already on the recipient list", () => {
    const fetched = [
      { email: "homer@aaa.com", name: "Homer" },
      { email: "marge@aaa.com", name: "Marge" },
    ];
    const added = [{ email: "homer@aaa.com", name: "" }];

    expect(selectableContacts(fetched, added)).toEqual([
      { email: "marge@aaa.com", name: "Marge" },
    ]);
  });

  it("matches an already-added recipient case-insensitively", () => {
    const fetched = [{ email: "Homer@AAA.com", name: "Homer" }];
    const added = [{ email: "homer@aaa.com", name: "" }];

    expect(selectableContacts(fetched, added)).toEqual([]);
  });
});
