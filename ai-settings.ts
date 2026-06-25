import type { LanguageModelCallOptions } from "ai";

import type { ChangeSet, GitChange } from "./changes";

export type AiReasoning = NonNullable<LanguageModelCallOptions["reasoning"]>;
export type CommitReasoningPhase = "planning" | "repair" | "message" | "chunk";

const LOW_REASONING: AiReasoning = "low";
const MEDIUM_REASONING: AiReasoning = "medium";
const PLANNING_MEDIUM_CHANGE_COUNT = 25;
const PLANNING_MEDIUM_COMPLEX_CHANGE_COUNT = 5;
const COMPLEX_PLANNING_KINDS = new Set<GitChange["kind"]>([
  "copied",
  "deleted",
  "renamed",
]);

export const PR_REASONING: AiReasoning = LOW_REASONING;

export const getCommitReasoning = (
  phase: CommitReasoningPhase,
  changeSet: ChangeSet,
): AiReasoning => {
  if (phase === "repair") return MEDIUM_REASONING;
  if (phase !== "planning") return LOW_REASONING;
  if (changeSet.changes.length > PLANNING_MEDIUM_CHANGE_COUNT) {
    return MEDIUM_REASONING;
  }

  const complexChanges = changeSet.changes.filter((change) =>
    COMPLEX_PLANNING_KINDS.has(change.kind),
  );
  return complexChanges.length > PLANNING_MEDIUM_COMPLEX_CHANGE_COUNT
    ? MEDIUM_REASONING
    : LOW_REASONING;
};
