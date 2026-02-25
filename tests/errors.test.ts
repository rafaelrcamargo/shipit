import { describe, expect, test } from "bun:test";

import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  NoSuchModelError,
  RetryError,
} from "ai";

import { formatAiError } from "../errors";

describe("formatAiError", () => {
  test("formats rate-limit errors with retry hint", () => {
    const error = new APICallError({
      message: "rate limited",
      url: "https://api.example.com",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "retry-after": "2" },
    });

    const formatted = formatAiError(error);
    expect(formatted).toContain("Rate limit hit (429)");
    expect(formatted).toContain("Retry after ~2s.");
  });

  test("formats retry exhaustion with nested API error details", () => {
    const lastError = new APICallError({
      message: "rate limited",
      url: "https://api.example.com",
      requestBodyValues: {},
      statusCode: 429,
    });
    const retryError = new RetryError({
      message: "max retries exceeded",
      reason: "maxRetriesExceeded",
      errors: [lastError],
    });

    const formatted = formatAiError(retryError);
    expect(formatted).toContain("AI request failed after retries.");
    expect(formatted).toContain("Rate limit hit (429)");
  });

  test("formats unknown model errors with env guidance", () => {
    const error = new NoSuchModelError({
      modelId: "openai:does-not-exist",
      modelType: "languageModel",
    });

    const formatted = formatAiError(error);
    expect(formatted).toContain("Unknown model for selected provider.");
    expect(formatted).toContain("SHIPIT_PROVIDER");
    expect(formatted).toContain("SHIPIT_MODEL");
  });

  test("formats API key load errors", () => {
    const error = new LoadAPIKeyError({ message: "missing OPENAI_API_KEY" });
    const formatted = formatAiError(error);
    expect(formatted).toContain("Missing or invalid API key configuration.");
  });

  test("formats JSON parse errors", () => {
    const error = new JSONParseError({
      text: "not-json",
      cause: new Error("Unexpected token"),
    });

    const formatted = formatAiError(error);
    expect(formatted).toContain("Provider returned malformed JSON output.");
  });
});
