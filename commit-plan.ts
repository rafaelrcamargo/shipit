import { generateText, type LanguageModel, Output } from "ai";

import {
  createCoverageRepairPrompt,
  formatCommitCoverageIssue,
  getChangedChangeIds,
  validateCommitCoverage,
  type ChangeSet,
} from "./changes";
import {
  type CommitGroup,
  responseSchema,
  systemInstruction,
  userInstruction,
} from "./constants";
import { defaultGenerationProviderOptions } from "./registry";

type GenerateCommitPlanParams = {
  model: LanguageModel;
  providerId: string;
  modelId: string;
  changeSet: ChangeSet;
  appendix?: string;
};

type GenerateCommitPlanResult = {
  commits: CommitGroup[];
};

export const createCommitPlanPrompt = (
  changeSet: ChangeSet,
  appendix?: string,
): string => userInstruction(changeSet, appendix);

const getEvidenceSize = (changeSet: ChangeSet): number =>
  changeSet.changes.reduce(
    (total, change) =>
      total +
      (change.evidence.diff?.length ?? 0) +
      (change.evidence.content?.length ?? 0),
    0,
  );

const getReasoningEffort = (
  changeSet: ChangeSet,
): "low" | "medium" | "high" => {
  const evidenceSize = getEvidenceSize(changeSet);

  if (changeSet.changes.length <= 5 && evidenceSize < 15000) return "low";
  if (changeSet.changes.length <= 20 && evidenceSize < 60000) return "medium";
  return "high";
};

const generateCommitGroups = async ({
  model,
  providerId,
  modelId,
  prompt,
  changeSet,
}: Pick<GenerateCommitPlanParams, "model" | "providerId" | "modelId"> & {
  prompt: string;
  changeSet: ChangeSet;
}): Promise<CommitGroup[]> => {
  const { output } = await generateText({
    model,
    providerOptions: defaultGenerationProviderOptions,
    output: Output.array({
      element: responseSchema,
      name: "commit",
      description: "A focused commit group",
    }),
    instructions: systemInstruction,
    prompt,
    reasoning: getReasoningEffort(changeSet),
    runtimeContext: {
      providerId,
      modelId,
      changeCount: changeSet.changes.length,
      fingerprint: changeSet.fingerprint,
    },
    telemetry: {
      isEnabled: false,
    },
  });

  return output;
};

export const generateCommitPlan = async ({
  model,
  providerId,
  modelId,
  changeSet,
  appendix,
}: GenerateCommitPlanParams): Promise<GenerateCommitPlanResult> => {
  const prompt = createCommitPlanPrompt(changeSet, appendix);
  const expectedChangeIds = getChangedChangeIds(changeSet);

  let commits = await generateCommitGroups({
    model,
    providerId,
    modelId,
    prompt,
    changeSet,
  });
  let coverageIssue = validateCommitCoverage(commits, expectedChangeIds);

  if (!coverageIssue.ok) {
    commits = await generateCommitGroups({
      model,
      providerId,
      modelId,
      prompt: createCoverageRepairPrompt(prompt, coverageIssue),
      changeSet,
    });
    coverageIssue = validateCommitCoverage(commits, expectedChangeIds);
  }

  if (!coverageIssue.ok) {
    throw new Error(
      `AI returned invalid change coverage:\n${formatCommitCoverageIssue(
        coverageIssue,
      )}`,
    );
  }

  return {
    commits,
  };
};
