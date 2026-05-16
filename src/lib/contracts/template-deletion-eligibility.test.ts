import { describe, it, expect } from "vitest";
import {
  evaluateTemplateDeletion,
  type ReferencingContract,
} from "./template-deletion-eligibility";

function ref(id: string, status: ReferencingContract["status"]): ReferencingContract {
  return { id, status };
}

describe("evaluateTemplateDeletion", () => {
  it("is deletable when no contracts reference the template", () => {
    const result = evaluateTemplateDeletion([]);
    expect(result).toEqual({ deletable: true, blockers: [], draftIds: [] });
  });

  it("blocks deletion when a `sent` contract references the template", () => {
    const result = evaluateTemplateDeletion([ref("c-1", "sent")]);
    expect(result.deletable).toBe(false);
    expect(result.blockers).toEqual([ref("c-1", "sent")]);
    expect(result.draftIds).toEqual([]);
  });

  it("blocks deletion when a `viewed` contract references the template", () => {
    const result = evaluateTemplateDeletion([ref("c-1", "viewed")]);
    expect(result.deletable).toBe(false);
    expect(result.blockers).toEqual([ref("c-1", "viewed")]);
  });

  it("collects `draft` contracts into draftIds without blocking", () => {
    const result = evaluateTemplateDeletion([
      ref("d-1", "draft"),
      ref("d-2", "draft"),
    ]);
    expect(result.deletable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.draftIds).toEqual(["d-1", "d-2"]);
  });

  it("treats `signed` contracts as deletable-through (retained, not a blocker, not a draft)", () => {
    const result = evaluateTemplateDeletion([ref("s-1", "signed")]);
    expect(result).toEqual({ deletable: true, blockers: [], draftIds: [] });
  });

  it("treats `expired` contracts as deletable-through", () => {
    const result = evaluateTemplateDeletion([ref("e-1", "expired")]);
    expect(result).toEqual({ deletable: true, blockers: [], draftIds: [] });
  });

  it("treats `voided` contracts as deletable-through", () => {
    const result = evaluateTemplateDeletion([ref("v-1", "voided")]);
    expect(result).toEqual({ deletable: true, blockers: [], draftIds: [] });
  });

  it("resolves a mixed set: blockers listed, drafts collected, terminals ignored", () => {
    const result = evaluateTemplateDeletion([
      ref("sent-1", "sent"),
      ref("viewed-1", "viewed"),
      ref("draft-1", "draft"),
      ref("draft-2", "draft"),
      ref("signed-1", "signed"),
      ref("expired-1", "expired"),
      ref("voided-1", "voided"),
    ]);
    expect(result.deletable).toBe(false);
    expect(result.blockers).toEqual([
      ref("sent-1", "sent"),
      ref("viewed-1", "viewed"),
    ]);
    expect(result.draftIds).toEqual(["draft-1", "draft-2"]);
  });

  it("is deletable when only drafts and terminal contracts reference the template", () => {
    const result = evaluateTemplateDeletion([
      ref("draft-1", "draft"),
      ref("signed-1", "signed"),
      ref("voided-1", "voided"),
    ]);
    expect(result.deletable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.draftIds).toEqual(["draft-1"]);
  });

  it("preserves blocker order as given by the caller", () => {
    const result = evaluateTemplateDeletion([
      ref("b-2", "viewed"),
      ref("b-1", "sent"),
    ]);
    expect(result.blockers.map((b) => b.id)).toEqual(["b-2", "b-1"]);
  });
});
