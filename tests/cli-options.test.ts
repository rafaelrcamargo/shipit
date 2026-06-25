import { describe, expect, test } from "bun:test";

import { normalizeCliOptions, normalizeTicketIds } from "../cli-options";

describe("normalizeCliOptions", () => {
  test("normalizes booleans and pull request aliases", () => {
    expect(
      normalizeCliOptions(
        { yes: true, push: true, pullRequest: true, skipTokenCheck: true },
        ["--yes", "--push", "--pull-request", "--skip-token-check"],
      ),
    ).toMatchObject({
      yes: true,
      push: true,
      createPullRequest: true,
      skipTokenCheck: true,
    });

    expect(normalizeCliOptions({ pr: true }, ["--pr"]).createPullRequest).toBe(
      true,
    );
  });

  test("normalizes repeated ticket IDs from raw argv", () => {
    expect(
      normalizeCliOptions({}, [
        "--ticket",
        "eng-123",
        "--ticket=API-456",
        "-t",
        "eng-123",
      ]).ticketIds,
    ).toEqual(["ENG-123", "API-456"]);
  });

  test("normalizes context without treating it as a ticket source", () => {
    const options = normalizeCliOptions({ context: "Implements eng-123" }, [
      "--context",
      "Implements eng-123",
    ]);

    expect(options.context).toBe("Implements eng-123");
    expect(options.ticketIds).toEqual([]);
  });

  test("does not validate context values as flags", () => {
    expect(
      normalizeCliOptions({ context: "--force" }, ["--context", "--force"])
        .context,
    ).toBe("--force");
  });

  test("rejects missing context text", () => {
    expect(() => normalizeCliOptions({ context: true }, ["--context"])).toThrow(
      "--context requires text.",
    );
  });

  test("rejects invalid ticket IDs", () => {
    expect(() => normalizeCliOptions({}, ["--ticket", "not-a-ticket"])).toThrow(
      'Invalid ticket ID "not-a-ticket"',
    );
    expect(() => normalizeCliOptions({}, ["--ticket"])).toThrow(
      "--ticket requires a ticket ID.",
    );
  });

  test("rejects more than five ticket IDs", () => {
    expect(() =>
      normalizeTicketIds(["AA-1", "BB-2", "CC-3", "DD-4", "EE-5", "FF-6"]),
    ).toThrow("Too many ticket IDs (6)");
  });

  test("rejects removed flags with replacement guidance", () => {
    expect(() => normalizeCliOptions({}, ["--force"])).toThrow(
      "--force was removed. Use --yes instead.",
    );
    expect(() => normalizeCliOptions({}, ["--unsafe"])).toThrow(
      "--unsafe was removed. Use --skip-token-check instead.",
    );
    expect(() => normalizeCliOptions({}, ["--appendix", "text"])).toThrow(
      "--appendix was removed. Use --context instead.",
    );
    expect(() => normalizeCliOptions({}, ["-fu"])).toThrow(
      "-f was removed. Use --yes instead.",
    );
  });
});
