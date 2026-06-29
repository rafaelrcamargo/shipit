import { generateText, type LanguageModel, Output, streamText } from "ai";

import { getCommitReasoning, type CommitReasoningPhase } from "./ai-settings";
import {
  createCoverageRepairPrompt,
  formatCommitCoverageIssue,
  getChangedChangeIds,
  getChangeEvidenceTextLength,
  getChangeSetForChangeIds,
  validateCommitCoverage,
  type ChangeSet,
} from "./changes";
import {
  chunkSummaryInstruction,
  chunkSummarySchema,
  commitMessageInstruction,
  commitMessageSchema,
  commitPlanGroupSchema,
  planningInstruction,
  type CommitGroup,
  type CommitMessage,
  type CommitPlanGroup,
  systemInstruction,
} from "./constants";
import type { RepoContext } from "./context";
import {
  createAiSdkProgressCallbacks,
  type AiProgressReporter,
  type AiRequestProgress,
} from "./progress";
import { defaultGenerationProviderOptions } from "./registry";

type GenerateCommitPlanParams = {
  model: LanguageModel;
  providerId: string;
  modelId: string;
  changeSet: ChangeSet;
  repoContext?: RepoContext;
  context?: string;
  progress?: AiProgressReporter;
  messageEvidenceCharLimit?: number;
  chunkEvidenceCharLimit?: number;
  ai?: Partial<CommitPlanAiClient>;
};

type GenerateCommitPlanResult = {
  commits: CommitGroup[];
};

type SharedAiRequestParams = Pick<
  GenerateCommitPlanParams,
  "model" | "providerId" | "modelId" | "repoContext" | "progress"
>;

type PlanGroupsParams = SharedAiRequestParams & {
  changeSet: ChangeSet;
  prompt: string;
  request: AiRequestProgress;
};

type WriteMessageParams = SharedAiRequestParams & {
  changeSet: ChangeSet;
  plannedGroup: CommitPlanGroup;
  context?: string;
  chunkSummaries?: string[];
  request: AiRequestProgress;
};

type SummarizeChunkParams = SharedAiRequestParams & {
  changeSet: ChangeSet;
  plannedGroup: CommitPlanGroup;
  chunkIndex: number;
  chunkCount: number;
  request: AiRequestProgress;
};

type CommitPlanAiClient = {
  planGroups: (params: PlanGroupsParams) => Promise<CommitPlanGroup[]>;
  writeMessage: (params: WriteMessageParams) => Promise<CommitMessage>;
  summarizeChunk: (params: SummarizeChunkParams) => Promise<string>;
};

const MESSAGE_EVIDENCE_CHAR_LIMIT = 60000;
const CHUNK_EVIDENCE_CHAR_LIMIT = 30000;
const DIRECT_COMMIT_CHANGE_LIMIT = 5;

export const createCommitPlanPrompt = (
  changeSet: ChangeSet,
  repoContext?: RepoContext,
  context?: string,
): string => planningInstruction(changeSet, repoContext, context);

const getEvidenceSize = (changeSet: ChangeSet): number =>
  changeSet.changes.reduce(
    (total, change) => total + getChangeEvidenceTextLength(change),
    0,
  );

const shouldWriteCommitDirectly = (
  changeSet: ChangeSet,
  messageEvidenceCharLimit: number,
): boolean =>
  changeSet.changes.length <= DIRECT_COMMIT_CHANGE_LIMIT &&
  getEvidenceSize(changeSet) <= messageEvidenceCharLimit;

const createDirectCommitGroup = (changeSet: ChangeSet): CommitPlanGroup => ({
  changeIds: getChangedChangeIds(changeSet),
  summary: "selected changes fit a single commit",
});

export const createCommitPromptPreview = (
  changeSet: ChangeSet,
  repoContext?: RepoContext,
  context?: string,
  {
    messageEvidenceCharLimit = MESSAGE_EVIDENCE_CHAR_LIMIT,
  }: {
    messageEvidenceCharLimit?: number;
  } = {},
): string =>
  shouldWriteCommitDirectly(changeSet, messageEvidenceCharLimit)
    ? commitMessageInstruction(
        changeSet,
        createDirectCommitGroup(changeSet),
        repoContext,
        context,
      )
    : createCommitPlanPrompt(changeSet, repoContext, context);

const defaultCommitPlanAi: CommitPlanAiClient = {
  planGroups: async ({
    model,
    providerId,
    modelId,
    prompt,
    changeSet,
    repoContext,
    progress,
    request,
  }) => {
    const reasoningPhase: CommitReasoningPhase =
      request.phase === "repair" ? "repair" : "planning";
    const result = streamText({
      model,
      providerOptions: defaultGenerationProviderOptions,
      output: Output.array({
        element: commitPlanGroupSchema,
        name: "commit_group",
        description: "A focused group of change IDs",
      }),
      instructions: systemInstruction,
      prompt,
      reasoning: getCommitReasoning(reasoningPhase, changeSet),
      runtimeContext: {
        providerId,
        modelId,
        changeCount: changeSet.changes.length,
        fingerprint: changeSet.fingerprint,
        branch: repoContext?.branch,
        baseBranch: repoContext?.baseBranch,
      },
      telemetry: {
        isEnabled: false,
      },
      ...createAiSdkProgressCallbacks(progress, request),
    });

    let streamedGroups = 0;
    for await (const streamedGroup of result.elementStream) {
      void streamedGroup;
      streamedGroups++;
      progress?.streamedElement(request, streamedGroups);
    }

    const warnings = await result.warnings;
    progress?.warning(request, warnings?.length ?? 0);
    return result.output;
  },
  writeMessage: async ({
    model,
    providerId,
    modelId,
    changeSet,
    plannedGroup,
    repoContext,
    context,
    chunkSummaries = [],
    progress,
    request,
  }) => {
    const result = await generateText({
      model,
      providerOptions: defaultGenerationProviderOptions,
      output: Output.object({ schema: commitMessageSchema }),
      instructions: systemInstruction,
      prompt: commitMessageInstruction(
        changeSet,
        plannedGroup,
        repoContext,
        context,
        chunkSummaries,
      ),
      reasoning: getCommitReasoning("message", changeSet),
      runtimeContext: {
        providerId,
        modelId,
        changeCount: changeSet.changes.length,
        fingerprint: changeSet.fingerprint,
        branch: repoContext?.branch,
        baseBranch: repoContext?.baseBranch,
      },
      telemetry: {
        isEnabled: false,
      },
      ...createAiSdkProgressCallbacks(progress, request),
    });

    const warnings = await result.warnings;
    progress?.warning(request, warnings?.length ?? 0);
    return result.output;
  },
  summarizeChunk: async ({
    model,
    providerId,
    modelId,
    changeSet,
    plannedGroup,
    chunkIndex,
    chunkCount,
    repoContext,
    progress,
    request,
  }) => {
    const result = await generateText({
      model,
      providerOptions: defaultGenerationProviderOptions,
      output: Output.object({ schema: chunkSummarySchema }),
      instructions: systemInstruction,
      prompt: chunkSummaryInstruction(
        changeSet,
        plannedGroup,
        chunkIndex,
        chunkCount,
      ),
      reasoning: getCommitReasoning("chunk", changeSet),
      runtimeContext: {
        providerId,
        modelId,
        changeCount: changeSet.changes.length,
        fingerprint: changeSet.fingerprint,
        branch: repoContext?.branch,
        baseBranch: repoContext?.baseBranch,
      },
      telemetry: {
        isEnabled: false,
      },
      ...createAiSdkProgressCallbacks(progress, request),
    });

    const warnings = await result.warnings;
    progress?.warning(request, warnings?.length ?? 0);
    return result.output.summary;
  },
};

const splitChangeSetIntoEvidenceChunks = (
  changeSet: ChangeSet,
  maxEvidenceChars: number,
): ChangeSet[] => {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;
  const limit = Math.max(1, maxEvidenceChars);

  for (const change of changeSet.changes) {
    const changeSize = Math.max(1, getChangeEvidenceTextLength(change));
    if (currentChunk.length > 0 && currentSize + changeSize > limit) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(change.id);
    currentSize += changeSize;
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);

  return chunks.map((changeIds) =>
    getChangeSetForChangeIds(changeSet, changeIds),
  );
};

const summarizeOversizedGroup = async ({
  ai,
  sharedParams,
  plannedGroup,
  groupChangeSet,
  groupIndex,
  chunkEvidenceCharLimit,
}: {
  ai: CommitPlanAiClient;
  sharedParams: SharedAiRequestParams;
  plannedGroup: CommitPlanGroup;
  groupChangeSet: ChangeSet;
  groupIndex: number;
  chunkEvidenceCharLimit: number;
}) => {
  const chunks = splitChangeSetIntoEvidenceChunks(
    groupChangeSet,
    chunkEvidenceCharLimit,
  );
  sharedParams.progress?.update(`Summarizing commit ${groupIndex} evidence...`);

  const summaries: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    summaries.push(
      await ai.summarizeChunk({
        ...sharedParams,
        changeSet: chunk,
        plannedGroup,
        chunkIndex: index + 1,
        chunkCount: chunks.length,
        request: {
          phase: "chunk",
          label: `Summarizing commit ${groupIndex} chunk`,
          requestIndex: index + 1,
          requestTotal: chunks.length,
        },
      }),
    );
  }

  return summaries;
};

export const generateCommitPlan = async ({
  model,
  providerId,
  modelId,
  changeSet,
  repoContext,
  context,
  progress,
  messageEvidenceCharLimit = MESSAGE_EVIDENCE_CHAR_LIMIT,
  chunkEvidenceCharLimit = CHUNK_EVIDENCE_CHAR_LIMIT,
  ai: aiOverrides = {},
}: GenerateCommitPlanParams): Promise<GenerateCommitPlanResult> => {
  const ai = { ...defaultCommitPlanAi, ...aiOverrides };
  const expectedChangeIds = getChangedChangeIds(changeSet);
  const sharedParams = { model, providerId, modelId, repoContext, progress };

  if (shouldWriteCommitDirectly(changeSet, messageEvidenceCharLimit)) {
    const plannedGroup = createDirectCommitGroup(changeSet);

    progress?.update("Writing commit...");
    const message = await ai.writeMessage({
      ...sharedParams,
      changeSet,
      plannedGroup,
      context,
      request: {
        phase: "message",
        label: "Writing commit",
      },
    });

    return {
      commits: [
        {
          changeIds: expectedChangeIds,
          ...message,
        },
      ],
    };
  }

  const prompt = createCommitPlanPrompt(changeSet, repoContext, context);

  progress?.update("Planning commit groups...");
  let plannedGroups = await ai.planGroups({
    ...sharedParams,
    prompt,
    changeSet,
    request: {
      phase: "planning",
      label: "Planning commit groups",
      durable: true,
    },
  });
  let coverageIssue = validateCommitCoverage(plannedGroups, expectedChangeIds);

  if (!coverageIssue.ok) {
    progress?.update("Repairing commit group coverage...");
    plannedGroups = await ai.planGroups({
      ...sharedParams,
      prompt: createCoverageRepairPrompt(prompt, coverageIssue),
      changeSet,
      request: {
        phase: "repair",
        label: "Repairing commit groups",
        durable: true,
      },
    });
    coverageIssue = validateCommitCoverage(plannedGroups, expectedChangeIds);
  }

  if (!coverageIssue.ok) {
    throw new Error(
      `AI returned invalid change coverage:\n${formatCommitCoverageIssue(
        coverageIssue,
      )}`,
    );
  }

  const commits: CommitGroup[] = [];
  for (const [index, plannedGroup] of plannedGroups.entries()) {
    const groupIndex = index + 1;
    const groupChangeSet = getChangeSetForChangeIds(
      changeSet,
      plannedGroup.changeIds,
    );
    const evidenceSize = getEvidenceSize(groupChangeSet);
    progress?.update(
      `Writing commits ${groupIndex}/${plannedGroups.length}...`,
    );
    const chunkSummaries =
      evidenceSize > messageEvidenceCharLimit
        ? await summarizeOversizedGroup({
            ai,
            sharedParams,
            plannedGroup,
            groupChangeSet,
            groupIndex,
            chunkEvidenceCharLimit,
          })
        : [];
    const message = await ai.writeMessage({
      ...sharedParams,
      changeSet: groupChangeSet,
      plannedGroup,
      context,
      chunkSummaries,
      request: {
        phase: "message",
        label: "Writing commits",
        requestIndex: groupIndex,
        requestTotal: plannedGroups.length,
      },
    });

    commits.push({
      changeIds: plannedGroup.changeIds,
      ...message,
    });
  }

  return {
    commits,
  };
};
