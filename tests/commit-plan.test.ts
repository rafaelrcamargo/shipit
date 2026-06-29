import { describe, expect, test } from "bun:test";

import type { ChangeSet, GitChange } from "../changes";
import { createCommitPromptPreview, generateCommitPlan } from "../commit-plan";
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
  test("writes one commit directly for small diffs", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
    ]);
    const progressMessages: string[] = [];
    const messageRequests: string[][] = [];
    let plannedGroup: CommitPlanGroup | undefined;

    const result = await generateCommitPlan({
      ...baseParams,
      changeSet,
      progress: {
        update: (message) => progressMessages.push(message),
        info: () => {},
        requestStart: () => {},
        requestEnd: () => {},
        streamedElement: () => {},
        warning: () => {},
      },
      ai: {
        planGroups: async () => {
          throw new Error("small diffs should not be planned");
        },
        writeMessage: async ({
          changeSet: groupChangeSet,
          plannedGroup: group,
        }) => {
          plannedGroup = group;
          messageRequests.push(groupChangeSet.changes.map((item) => item.id));
          return message("write small diff");
        },
      },
    });

    expect(progressMessages).toEqual(["Writing commit..."]);
    expect(messageRequests).toEqual([["C001", "C002"]]);
    expect(plannedGroup?.changeIds).toEqual(["C001", "C002"]);
    expect(result.commits).toEqual([
      expect.objectContaining({
        changeIds: ["C001", "C002"],
        description: "write small diff",
      }),
    ]);
  });

  test("plans groups first and writes messages with group-only changes", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
      change("C003", "src/c.ts"),
      change("C004", "src/d.ts"),
      change("C005", "src/e.ts"),
      change("C006", "src/f.ts"),
    ]);
    const messageRequests: string[][] = [];
    const progressMessages: string[] = [];

    const result = await generateCommitPlan({
      ...baseParams,
      changeSet,
      progress: {
        update: (message) => progressMessages.push(message),
        info: () => {},
        requestStart: () => {},
        requestEnd: () => {},
        streamedElement: () => {},
        warning: () => {},
      },
      ai: {
        planGroups: async () => [
          { changeIds: ["C001", "C002", "C003"], summary: "update first set" },
          {
            changeIds: ["C004", "C005", "C006"],
            summary: "update second set",
          },
        ],
        writeMessage: async ({
          changeSet: groupChangeSet,
          plannedGroup,
          request,
        }) => {
          messageRequests.push(groupChangeSet.changes.map((item) => item.id));
          progressMessages.push(
            `${request.label} ${request.requestIndex}/${request.requestTotal}`,
          );
          return message(plannedGroup.summary);
        },
      },
    });

    expect(messageRequests).toEqual([
      ["C001", "C002", "C003"],
      ["C004", "C005", "C006"],
    ]);
    expect(result.commits).toEqual([
      expect.objectContaining({
        changeIds: ["C001", "C002", "C003"],
        description: "update first set",
      }),
      expect.objectContaining({
        changeIds: ["C004", "C005", "C006"],
        description: "update second set",
      }),
    ]);
    expect(progressMessages).toContain("Writing commits 1/2...");
    expect(progressMessages).toContain("Writing commits 1/2");
    expect(progressMessages).not.toContain("Writing commit 1 1/2");
  });

  test("repairs invalid planning coverage once", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
      change("C003", "src/c.ts"),
      change("C004", "src/d.ts"),
      change("C005", "src/e.ts"),
      change("C006", "src/f.ts"),
    ]);
    const plannedResponses: CommitPlanGroup[][] = [
      [{ changeIds: ["C001"], summary: "partial" }],
      [
        {
          changeIds: ["C001", "C002", "C003", "C004", "C005", "C006"],
          summary: "complete",
        },
      ],
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
    expect(result.commits[0]?.changeIds).toEqual([
      "C001",
      "C002",
      "C003",
      "C004",
      "C005",
      "C006",
    ]);
  });

  test("fails after one unsuccessful coverage repair", async () => {
    const changeSet = createChangeSet([
      change("C001", "src/a.ts"),
      change("C002", "src/b.ts"),
      change("C003", "src/c.ts"),
      change("C004", "src/d.ts"),
      change("C005", "src/e.ts"),
      change("C006", "src/f.ts"),
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

describe("createCommitPromptPreview", () => {
  test("uses the direct commit prompt for small diffs", () => {
    const prompt = createCommitPromptPreview(
      createChangeSet([change("C001", "src/a.ts")]),
    );

    expect(prompt).toContain("## Commit Message:");
    expect(prompt).toContain('"diff":"');
    expect(prompt).not.toContain("## Commit Groups:");
  });

  test("uses the planning prompt for larger or evidence-heavy diffs", () => {
    const largePrompt = createCommitPromptPreview(
      createChangeSet([
        change("C001", "src/a.ts"),
        change("C002", "src/b.ts"),
        change("C003", "src/c.ts"),
        change("C004", "src/d.ts"),
        change("C005", "src/e.ts"),
        change("C006", "src/f.ts"),
      ]),
    );
    const evidenceHeavyPrompt = createCommitPromptPreview(
      createChangeSet([change("C001", "src/a.ts", 1000)]),
      undefined,
      undefined,
      { messageEvidenceCharLimit: 500 },
    );

    expect(largePrompt).toContain("## Commit Groups:");
    expect(largePrompt).not.toContain('"diff":"');
    expect(evidenceHeavyPrompt).toContain("## Commit Groups:");
    expect(evidenceHeavyPrompt).not.toContain('"diff":"');
  });
});
