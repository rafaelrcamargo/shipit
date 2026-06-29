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

export type AiRequestResult = AiRequestProgress;

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
    spinner.message(`${request.label}${formatRequestPosition(request)}`);
  },
  requestEnd: () => {},
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
  onLanguageModelCallEnd: () => {
    progress?.requestEnd(request);
  },
});
