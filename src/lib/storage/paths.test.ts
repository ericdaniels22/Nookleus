import { describe, it, expect } from "vitest";
import { sanitizeStorageFilename, emailAttachmentPath } from "./paths";

// Oracle: a strict mirror of storage-api's `isValidKey` whitelist
// (https://github.com/supabase/storage). Anything our sanitizer emits MUST
// satisfy this, or Supabase rejects the upload with a 400 "Invalid key".
const SUPABASE_VALID_KEY = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

describe("sanitizeStorageFilename", () => {
  it("strips the em dash that mail clients insert (the reported bug)", () => {
    // "Work Authorization — Michelle Baker.pdf" — the em dash (U+2014) is the
    // character Supabase rejected, producing the "Invalid key" error.
    const out = sanitizeStorageFilename("Work Authorization — Michelle Baker.pdf");
    expect(out).not.toContain("—");
    expect(SUPABASE_VALID_KEY.test(out)).toBe(true);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("preserves the extension", () => {
    expect(sanitizeStorageFilename("invoice.PDF")).toMatch(/\.PDF$/);
    expect(sanitizeStorageFilename("archive.tar.gz")).toBe("archive.tar.gz");
  });

  it("keeps an already-clean name intact", () => {
    expect(sanitizeStorageFilename("quote-2026.pdf")).toBe("quote-2026.pdf");
  });

  it("folds accented letters to ASCII", () => {
    expect(sanitizeStorageFilename("résumé.pdf")).toBe("resume.pdf");
  });

  it("drops path separators so the result is a single key segment", () => {
    expect(sanitizeStorageFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeStorageFilename("C:\\Users\\x\\bad name.pdf")).toBe("bad_name.pdf");
  });

  it("falls back to a non-empty name when nothing survives", () => {
    expect(sanitizeStorageFilename("———.pdf")).toBe("file.pdf");
    expect(sanitizeStorageFilename("")).toBe("file");
  });

  it("produces a valid Supabase key for a battery of nasty inputs", () => {
    const inputs = [
      "Work Authorization — Michelle Baker.pdf",
      "report #3 (final) 50%.pdf",
      "“quoted” & <weird>.docx",
      "emoji 🚀 rocket.png",
      "tab\tand\nnewline.txt",
      "back`tick`~caret^.pdf",
      "spaces   collapse.pdf",
      "no-extension",
    ];
    for (const input of inputs) {
      const out = sanitizeStorageFilename(input);
      expect(out.length).toBeGreaterThan(0);
      expect(SUPABASE_VALID_KEY.test(out)).toBe(true);
      // Defence-in-depth: also confirm none of the most dangerous chars survive.
      expect(out).not.toMatch(/[#%<>`^~\\]/);
    }
  });
});

describe("emailAttachmentPath", () => {
  it("sanitizes the filename segment (inbound-sync + send share this builder)", () => {
    const path = emailAttachmentPath(
      "org-1",
      "acct-2",
      "email-3",
      "Work Authorization — Michelle Baker.pdf",
    );
    expect(path).toBe("org-1/acct-2/email-3/Work_Authorization_Michelle_Baker.pdf");
    expect(SUPABASE_VALID_KEY.test(path)).toBe(true);
  });

  it("leaves the org/account/email prefix untouched", () => {
    const path = emailAttachmentPath("org", "acct", "email", "clean.pdf");
    expect(path).toBe("org/acct/email/clean.pdf");
  });
});
