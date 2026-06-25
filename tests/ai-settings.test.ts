import { describe, expect, test } from "bun:test";

import {
  getCommitReasoning,
  PR_REASONING,
  type CommitReasoningPhase,
} from "../ai-settings";
import type { ChangeSet, GitChange } from "../changes";
import { defaultGenerationProviderOptions } from "../registry";

const change = (
  id: string,
  kind: GitChange["kind"] = "modified",
): GitChange => ({
  id,
  identity: `${kind}:\0${id}.ts`,
  kind,
  path: `${id}.ts`,
  indexState: ".",
  worktreeState: "M",
  stagePathspecs: [`${id}.ts`],
  commitPathspecs: [`${id}.ts`],
  evidence: {
    summary: `${kind}: ${id}.ts`,
    isNoisy: false,
    isBinary: false,
    isTruncated: false,
    isSummaryOnly: false,
    isUnavailable: false,
  },
  fingerprint: id,
});

const changeSet = (changes: GitChange[]): ChangeSet => ({
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

const changes = (count: number, kind?: GitChange["kind"]) =>
  Array.from({ length: count }, (_, index) =>
    change(`C${String(index + 1).padStart(3, "0")}`, kind),
  );

describe("AI reasoning settings", () => {
  test("keeps normal commit and PR requests on low reasoning", () => {
    const smallChangeSet = changeSet(changes(3));
    const broadChangeSet = changeSet(changes(40));
    const expectations: Array<[CommitReasoningPhase, ChangeSet]> = [
      ["planning", smallChangeSet],
      ["message", broadChangeSet],
      ["chunk", broadChangeSet],
    ];

    for (const [phase, currentChangeSet] of expectations) {
      expect(getCommitReasoning(phase, currentChangeSet)).toBe("low");
    }
    expect(PR_REASONING).toBe("low");
  });

  test("uses medium reasoning only for repair or unusually broad planning", () => {
    expect(getCommitReasoning("repair", changeSet(changes(3)))).toBe("medium");
    expect(getCommitReasoning("planning", changeSet(changes(26)))).toBe(
      "medium",
    );
    expect(
      getCommitReasoning("planning", changeSet(changes(6, "renamed"))),
    ).toBe("medium");
  });

  test("does not request unused OpenAI reasoning summaries", () => {
    expect(defaultGenerationProviderOptions.openai).toMatchObject({
      reasoningSummary: null,
    });
  });
});
