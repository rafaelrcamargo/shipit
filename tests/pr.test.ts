import { describe, expect, test } from "bun:test";

import { getPullRequestPushState } from "../pr";

describe("getPullRequestPushState", () => {
  test("reports up-to-date branches", async () => {
    const calls: string[][] = [];
    const state = await getPullRequestPushState(async (args) => {
      calls.push(args);
      return { total: 0 };
    }, "feature/test");

    expect(state).toEqual({ status: "up-to-date" });
    expect(calls).toEqual([["origin/feature/test..HEAD", "--oneline"]]);
  });

  test("reports unpushed commits", async () => {
    const state = await getPullRequestPushState(
      async () => ({ total: 2 }),
      "feature/test",
    );

    expect(state).toEqual({ status: "needs-push", commitCount: 2 });
  });

  test("reports first-push branches when the remote branch is missing", async () => {
    const state = await getPullRequestPushState(async () => {
      throw new Error(
        "fatal: ambiguous argument 'origin/feature/test..HEAD': unknown revision or path not in the working tree",
      );
    }, "feature/test");

    expect(state).toEqual({ status: "needs-first-push" });
  });

  test("rethrows remote errors that are not missing tracking branches", async () => {
    await expect(
      getPullRequestPushState(async () => {
        throw new Error("Authentication failed");
      }, "feature/test"),
    ).rejects.toThrow("Authentication failed");
  });
});
