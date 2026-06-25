import { describe, expect, test } from "bun:test";

import type { ChangeSet, GitChange } from "../changes";
import { generateCommitPlan } from "../commit-plan";
import type { CommitMessage, CommitPlanGroup } from "../constants";

const change = (id: string, path: string, diffLength = 100): GitChange => ({
  id,
  identity: `modified:\0${path}`,
  kind: "modified",
  path,
  indexState: ".",
  worktreeState: "M",
  stagePathspecs: [path],
  commitPathspecs: [path],
  evidence: {
    summary: `modified: ${path}`,
    diff: "x".repeat(diffLength),
    isNoisy: false,
    isBinary: false,
    isTruncated: false,
    isSummaryOnly: false,
    isUnavailable: false,
  },
  fingerprint: path,
});

const createChangeSet = (changes: GitChange[]): ChangeSet => ({
  selectedPaths: [],
  changes,
  allChanges: changes,
  conflicts: [],
  stagedOutsideSelectedChanges: [],
  fingerprint: "fingerprint",
  counts: {
    modified: changes.length,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
  },
});

const message = (description: string): CommitMessage => ({
  type: "fix",
  scope: null,
  description,
  body: null,
  breaking: false,
  footers: null,
});

const baseParams = {
  model: "test-model",
  providerId: "test",
  modelId: "test-model",
};

describe("generateCommitPlan", () => {
  test("plans groups first and writes messages with group-only changes", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
    ]);
    const messageRequests: string[][] = [];

    const result = await generateCommitPlan({
      ...baseParams,
      changeSet,
      ai: {
        planGroups: async () => [
          { changeIds: ["C001"], summary: "update a" },
          { changeIds: ["C002"], summary: "update b" },
        ],
        writeMessage: async ({ changeSet: groupChangeSet, plannedGroup }) => {
          messageRequests.push(groupChangeSet.changes.map((item) => item.id));
          return message(plannedGroup.summary);
        },
      },
    });

    expect(messageRequests).toEqual([["C001"], ["C002"]]);
    expect(result.commits).toEqual([
      expect.objectContaining({ changeIds: ["C001"], description: "update a" }),
      expect.objectContaining({ changeIds: ["C002"], description: "update b" }),
    ]);
  });

  test("repairs invalid planning coverage once", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
    ]);
    const plannedResponses: CommitPlanGroup[][] = [
      [{ changeIds: ["C001"], summary: "partial" }],
      [{ changeIds: ["C001", "C002"], summary: "complete" }],
    ];

    const result = await generateCommitPlan({
      ...baseParams,
      changeSet,
      ai: {
        planGroups: async () => plannedResponses.shift() ?? [],
        writeMessage: async ({ plannedGroup }) => message(plannedGroup.summary),
      },
    });

    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]?.changeIds).toEqual(["C001", "C002"]);
  });

  test("fails after one unsuccessful coverage repair", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
    ]);

    await expect(
      generateCommitPlan({
        ...baseParams,
        changeSet,
        ai: {
          planGroups: async () => [{ changeIds: ["C001"], summary: "partial" }],
          writeMessage: async ({ plannedGroup }) =>
            message(plannedGroup.summary),
        },
      }),
    ).rejects.toThrow("Missing: C002");
  });

  test("summarizes oversized group chunks before writing the message", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts", 1000),
      change("C002", "src/b.ts", 1000),
      change("C003", "src/c.ts", 1000),
    ]);
    const chunkRequests: string[][] = [];
    let receivedChunkSummaries: string[] = [];

    const result = await generateCommitPlan({
      ...baseParams,
      changeSet,
      messageEvidenceCharLimit: 1500,
      chunkEvidenceCharLimit: 900,
      ai: {
        planGroups: async () => [
          { changeIds: ["C001", "C002", "C003"], summary: "large update" },
        ],
        summarizeChunk: async ({ changeSet: chunkChangeSet, chunkIndex }) => {
          chunkRequests.push(chunkChangeSet.changes.map((item) => item.id));
          return `summary ${chunkIndex}`;
        },
        writeMessage: async ({ chunkSummaries }) => {
          receivedChunkSummaries = chunkSummaries ?? [];
          return message("use chunk summaries");
        },
      },
    });

    expect(chunkRequests).toEqual([["C001"], ["C002"], ["C003"]]);
    expect(receivedChunkSummaries).toEqual([
      "summary 1",
      "summary 2",
      "summary 3",
    ]);
    expect(result.commits[0]?.changeIds).toEqual(["C001", "C002", "C003"]);
  });
});
