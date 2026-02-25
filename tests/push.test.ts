import { describe, expect, test } from "bun:test";

import { handlePush } from "../push";

type CommitLog = {
  total: number;
  all: Array<{ hash: string }>;
};

const createHarness = ({
  branch = "feature/test",
  remoteUrl = "git@github.com:owner/repo.git",
  logImpl,
  confirmImpl = async () => true,
}: {
  branch?: string;
  remoteUrl?: string;
  logImpl: (args: string[]) => Promise<CommitLog>;
  confirmImpl?: (params: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean>;
}) => {
  const pushCalls: Array<[string, string, string[]?]> = [];
  const confirmCalls: Array<{ message: string; initialValue?: boolean }> = [];
  const infoLogs: string[] = [];
  const spinnerEvents: string[] = [];

  const git = {
    revparse: async () => branch,
    getConfig: async () => ({ value: remoteUrl }),
    log: async (args: string[]) => logImpl(args),
    push: async (remote: string, branchName: string, options?: string[]) => {
      pushCalls.push([remote, branchName, options]);
    },
  };

  const log = {
    info: (message: string) => infoLogs.push(message),
  };

  const spinner = () => ({
    start: (message: string) => spinnerEvents.push(`start:${message}`),
    stop: (message: string) => spinnerEvents.push(`stop:${message}`),
    message: (message: string) => spinnerEvents.push(`message:${message}`),
    cancel: () => {},
    error: () => {},
    clear: () => {},
    isCancelled: false,
  });

  const confirm = async (params: {
    message: string;
    initialValue?: boolean;
  }) => {
    confirmCalls.push(params);
    return confirmImpl(params);
  };

  return {
    git,
    log,
    spinner,
    confirm,
    pushCalls,
    confirmCalls,
    infoLogs,
    spinnerEvents,
  };
};

describe("handlePush", () => {
  test("does not push when no remote is configured", async () => {
    const harness = createHarness({
      remoteUrl: "",
      logImpl: async () => ({
        total: 1,
        all: [{ hash: "abc123" }],
      }),
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123"],
    });

    expect(harness.pushCalls).toHaveLength(0);
    expect(harness.confirmCalls).toHaveLength(0);
    expect(harness.infoLogs).toContain(
      "No remote? No push. Your code is safe... for now 🤷",
    );
  });

  test("does not push when branch is already up to date", async () => {
    const harness = createHarness({
      logImpl: async () => ({
        total: 0,
        all: [],
      }),
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123"],
    });

    expect(harness.pushCalls).toHaveLength(0);
    expect(harness.confirmCalls).toHaveLength(0);
    expect(harness.spinnerEvents.at(-1)).toBe(
      "stop:Nothing to push. Your branch is up to date. 👍",
    );
  });

  test("happy path pushes unpushed commits created by shipit without prompts", async () => {
    const harness = createHarness({
      logImpl: async () => ({
        total: 2,
        all: [{ hash: "abc123" }, { hash: "def456" }],
      }),
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123", "def456"],
    });

    expect(harness.confirmCalls).toHaveLength(0);
    expect(harness.pushCalls).toEqual([["origin", "feature/test", undefined]]);
  });

  test("asks confirmation when unpushed commits include hashes not created this run", async () => {
    const harness = createHarness({
      logImpl: async () => ({
        total: 2,
        all: [{ hash: "abc123" }, { hash: "zzz999" }],
      }),
      confirmImpl: async () => true,
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123"],
    });

    expect(harness.confirmCalls).toHaveLength(1);
    expect(harness.confirmCalls[0]?.message).toContain(
      "were not created by shipit in this run",
    );
    expect(harness.pushCalls).toEqual([["origin", "feature/test", undefined]]);
  });

  test("does not push when no shipit commits were created and user declines", async () => {
    const harness = createHarness({
      logImpl: async () => ({
        total: 1,
        all: [{ hash: "zzz999" }],
      }),
      confirmImpl: async () => false,
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: [],
    });

    expect(harness.confirmCalls).toHaveLength(1);
    expect(harness.confirmCalls[0]?.message).toContain(
      "No new shipit commits were created.",
    );
    expect(harness.pushCalls).toHaveLength(0);
    expect(harness.spinnerEvents.at(-1)).toBe("stop:Skipped push.");
  });

  test("does not push when mixed commits exist and user declines", async () => {
    const harness = createHarness({
      logImpl: async () => ({
        total: 2,
        all: [{ hash: "abc123" }, { hash: "zzz999" }],
      }),
      confirmImpl: async () => false,
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123"],
    });

    expect(harness.confirmCalls).toHaveLength(1);
    expect(harness.confirmCalls[0]?.message).toContain(
      "were not created by shipit in this run",
    );
    expect(harness.pushCalls).toHaveLength(0);
    expect(harness.spinnerEvents.at(-1)).toBe("stop:Skipped push.");
  });

  test("first push flow sets upstream when tracking branch does not exist", async () => {
    const harness = createHarness({
      logImpl: async () => {
        throw new Error("unknown revision");
      },
      confirmImpl: async () => true,
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123"],
    });

    expect(harness.confirmCalls).toHaveLength(1);
    expect(harness.pushCalls).toEqual([
      ["origin", "feature/test", ["--set-upstream"]],
    ]);
  });

  test("first push with no shipit commits defaults confirmation to false", async () => {
    const harness = createHarness({
      logImpl: async () => {
        throw new Error("unknown revision");
      },
      confirmImpl: async () => false,
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: [],
    });

    expect(harness.confirmCalls).toHaveLength(1);
    expect(harness.confirmCalls[0]?.initialValue).toBe(false);
    expect(harness.confirmCalls[0]?.message).toContain(
      "No new commits were created by shipit.",
    );
    expect(harness.pushCalls).toHaveLength(0);
  });

  test("surfaces non-tracking-branch errors instead of treating them as first push", async () => {
    const harness = createHarness({
      logImpl: async () => {
        throw new Error("Authentication failed");
      },
    });

    await handlePush({
      git: harness.git as never,
      log: harness.log as never,
      spinner: harness.spinner as never,
      confirm: harness.confirm as never,
      createdCommitHashes: ["abc123"],
    });

    expect(harness.confirmCalls).toHaveLength(0);
    expect(harness.pushCalls).toHaveLength(0);
    expect(harness.spinnerEvents.at(-1)).toBe(
      "stop:Push failed! You'll need to handle that manually: Authentication failed",
    );
  });
});
