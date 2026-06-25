import type { FinishReason, LanguageModelUsage } from "ai";

import type { Prompts } from "./prompts";

type Spinner = ReturnType<Prompts["spinner"]>;
type ProgressLog = Pick<Prompts["log"], "info">;

export type AiRequestProgress = {
  phase: "planning" | "repair" | "message" | "chunk" | "pr";
  label: string;
  requestIndex?: number;
  requestTotal?: number;
  durable?: boolean;
};

export type AiRequestResult = AiRequestProgress & {
  finishReason?: FinishReason | string;
  usage?: LanguageModelUsage;
  durationMs?: number;
};

export type AiProgressReporter = {
  update: (message: string) => void;
  info: (message: string) => void;
  requestStart: (request: AiRequestProgress) => void;
  requestEnd: (result: AiRequestResult) => void;
  streamedElement: (request: AiRequestProgress, completed: number) => void;
  warning: (request: AiRequestProgress, warningCount: number) => void;
};

const formatRequestPosition = ({
  requestIndex,
  requestTotal,
}: AiRequestProgress) =>
  requestIndex !== undefined && requestTotal !== undefined
    ? ` ${requestIndex}/${requestTotal}`
    : "";

const formatStreamedElement = (completed: number) =>
  `${completed} ${completed === 1 ? "group" : "groups"} ready`;

const formatDuration = (durationMs: number | undefined) =>
  durationMs === undefined
    ? undefined
    : durationMs >= 1000
      ? `${(durationMs / 1000).toFixed(1)}s`
      : `${Math.round(durationMs)}ms`;

export const formatUsage = (usage: LanguageModelUsage | undefined) => {
  if (!usage) return undefined;

  const parts = [
    usage.inputTokens !== undefined ? `${usage.inputTokens} in` : undefined,
    usage.outputTokens !== undefined ? `${usage.outputTokens} out` : undefined,
    usage.totalTokens !== undefined ? `${usage.totalTokens} total` : undefined,
  ].filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts.join(", ") : undefined;
};

export const formatAiRequestResult = (result: AiRequestResult) => {
  const details = [
    formatDuration(result.durationMs),
    result.finishReason ? `finish: ${result.finishReason}` : undefined,
    formatUsage(result.usage),
  ].filter((detail): detail is string => detail !== undefined);

  return `${result.label} done${details.length ? ` (${details.join("; ")})` : ""}`;
};

export const createSpinnerProgressReporter = ({
  spinner,
  log,
}: {
  spinner: Spinner;
  log: ProgressLog;
}): AiProgressReporter => ({
  update: (message) => spinner.message(message),
  info: (message) => log.info(message),
  requestStart: (request) => {
    spinner.message(
      `${request.label}${formatRequestPosition(request)} calling model`,
    );
  },
  requestEnd: (result) => {
    const message = formatAiRequestResult(result);
    if (result.durable) {
      log.info(message);
    } else {
      spinner.message(message);
    }
  },
  streamedElement: (request, completed) => {
    spinner.message(
      `${request.label}${formatRequestPosition(request)} (${formatStreamedElement(completed)})`,
    );
  },
  warning: (request, warningCount) => {
    if (warningCount > 0) {
      log.info(`${request.label}: ${warningCount} provider warning(s).`);
    }
  },
});

export const createAiSdkProgressCallbacks = (
  progress: AiProgressReporter | undefined,
  request: AiRequestProgress,
) => ({
  onLanguageModelCallStart: () => {
    progress?.requestStart(request);
  },
  onLanguageModelCallEnd: (event: {
    finishReason?: FinishReason | string;
    usage?: LanguageModelUsage;
    performance?: { responseTimeMs?: number };
  }) => {
    progress?.requestEnd({
      ...request,
      finishReason: event.finishReason,
      usage: event.usage,
      durationMs: event.performance?.responseTimeMs,
    });
  },
});
