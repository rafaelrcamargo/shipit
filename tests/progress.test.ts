import { describe, expect, test } from "bun:test";

import {
  createSpinnerProgressReporter,
  formatAiRequestResult,
  formatUsage,
} from "../progress";

const createHarness = () => {
  const spinnerMessages: string[] = [];
  const infoLogs: string[] = [];

  return {
    spinnerMessages,
    infoLogs,
    reporter: createSpinnerProgressReporter({
      spinner: {
        start: () => {},
        stop: () => {},
        message: (message: string) => spinnerMessages.push(message),
        cancel: () => {},
        error: () => {},
        clear: () => {},
        isCancelled: false,
      },
      log: {
        info: (message: string) => infoLogs.push(message),
      },
    }),
  };
};

describe("AI progress reporting", () => {
  test("uses spinner updates for frequent progress", () => {
    const { reporter, spinnerMessages, infoLogs } = createHarness();
    const request = {
      phase: "planning" as const,
      label: "Planning commit groups",
    };

    reporter.requestStart(request);
    reporter.streamedElement(request, 1);
    reporter.streamedElement(request, 2);

    expect(spinnerMessages).toHaveLength(3);
    expect(spinnerMessages[0]).toBe("Planning commit groups calling model");
    expect(spinnerMessages.at(-1)).toBe(
      "Planning commit groups (2 groups ready)",
    );
    expect(infoLogs).toEqual([]);
  });

  test("logs durable request completions without prompt or output text", () => {
    const { reporter, spinnerMessages, infoLogs } = createHarness();

    reporter.requestEnd({
      phase: "planning",
      label: "Planning commit groups",
      durable: true,
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: 5,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: 15,
      },
      durationMs: 1250,
    });

    expect(spinnerMessages).toEqual([]);
    expect(infoLogs).toEqual([
      "Planning commit groups done (1.3s; finish: stop; 10 in, 5 out, 15 total)",
    ]);
  });

  test("formats request usage compactly", () => {
    expect(
      formatAiRequestResult({
        phase: "message",
        label: "Writing commit 1",
        finishReason: "stop",
      }),
    ).toBe("Writing commit 1 done (finish: stop)");
    expect(
      formatUsage({
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: 8,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: 8,
      }),
    ).toBe("8 out, 8 total");
  });
});
