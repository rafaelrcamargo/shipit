import { describe, expect, test } from "bun:test";

import { createSpinnerProgressReporter } from "../progress";

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
    expect(spinnerMessages[0]).toBe("Planning commit groups");
    expect(spinnerMessages.at(-1)).toBe(
      "Planning commit groups (2 groups ready)",
    );
    expect(infoLogs).toEqual([]);
  });

  test("keeps request completions quiet", () => {
    const { reporter, spinnerMessages, infoLogs } = createHarness();

    reporter.requestEnd({
      phase: "planning",
      label: "Planning commit groups",
      durable: true,
    });

    expect(spinnerMessages).toEqual([]);
    expect(infoLogs).toEqual([]);
  });

  test("logs provider warnings", () => {
    const { reporter, infoLogs } = createHarness();

    reporter.warning(
      {
        phase: "message",
        label: "Writing commit 1",
      },
      2,
    );

    expect(infoLogs).toEqual(["Writing commit 1: 2 provider warning(s)."]);
  });
});
