import { describe, it, expect } from "vitest";
import { rankPickerJobs } from "./job-picker";

// issue #701 — the active-Job picker lets a worker find the Job to clock into
// by typing part of the address, the customer's name, or the job number, and
// surfaces the Jobs they most recently clocked into first. This pure module is
// that filter + ranking; the React picker feeds it candidate (Active) Jobs.

const maple = {
  id: "job-maple",
  job_number: "J-1001",
  property_address: "12 Maple St",
  contact: { full_name: "Ada Lovelace" },
};
const oak = {
  id: "job-oak",
  job_number: "J-1002",
  property_address: "988 Oak Ave",
  contact: { full_name: "Grace Hopper" },
};
const pine = {
  id: "job-pine",
  job_number: "J-1003",
  property_address: "5 Pine Ct",
  contact: { full_name: "Alan Turing" },
};

describe("rankPickerJobs (#701)", () => {
  it("filters by a case-insensitive property-address substring", () => {
    const result = rankPickerJobs([maple, oak], { query: "maple", recentJobIds: [] });
    expect(result.map((j) => j.id)).toEqual(["job-maple"]);
  });

  it("filters by the customer's name", () => {
    const result = rankPickerJobs([maple, oak], { query: "grace", recentJobIds: [] });
    expect(result.map((j) => j.id)).toEqual(["job-oak"]);
  });

  it("filters by the job number", () => {
    const result = rankPickerJobs([maple, oak], { query: "1002", recentJobIds: [] });
    expect(result.map((j) => j.id)).toEqual(["job-oak"]);
  });

  it("returns every candidate when the query is blank", () => {
    const result = rankPickerJobs([maple, oak], { query: "   ", recentJobIds: [] });
    expect(result.map((j) => j.id)).toEqual(["job-maple", "job-oak"]);
  });

  it("ranks recently-clocked Jobs first, in recency order, then the rest", () => {
    const result = rankPickerJobs([maple, oak, pine], {
      query: "",
      recentJobIds: ["job-oak", "job-maple"],
    });
    expect(result.map((j) => j.id)).toEqual(["job-oak", "job-maple", "job-pine"]);
  });

  it("floats the recently-clocked Job to the top of a narrowed search", () => {
    const elmA = { id: "elm-a", job_number: "J-2001", property_address: "1 Elm St" };
    const elmB = { id: "elm-b", job_number: "J-2002", property_address: "2 Elm St" };
    const result = rankPickerJobs([elmA, elmB, pine], {
      query: "elm",
      recentJobIds: ["elm-b"],
    });
    expect(result.map((j) => j.id)).toEqual(["elm-b", "elm-a"]);
  });
});
