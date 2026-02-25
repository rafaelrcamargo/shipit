import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoObjectGeneratedError,
  NoSuchModelError,
  RetryError,
  TypeValidationError,
} from "ai";

import { getErrorMessage } from "./utils";

const getRetryAfterHint = (error: APICallError): string => {
  const headers = error.responseHeaders ?? {};
  const retryAfterMs = headers["retry-after-ms"];
  const retryAfter = headers["retry-after"];

  if (retryAfterMs) {
    const ms = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(ms) && ms >= 0) {
      const seconds = Math.ceil(ms / 1000);
      return ` Retry after ~${seconds}s.`;
    }
  }

  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return ` Retry after ~${Math.ceil(seconds)}s.`;
    }
  }

  return "";
};

const formatApiCallError = (error: APICallError): string => {
  const status = error.statusCode;

  if (status === 429) {
    return `Rate limit hit (429). Split large diffs, retry later, or pick another provider/model.${getRetryAfterHint(
      error,
    )}`;
  }

  if (status === 413) {
    return "Request too large for the provider (413). Split your diff into smaller commits or use a model with higher context limits.";
  }

  if (status === 401 || status === 403) {
    return "Provider authentication failed. Verify the API key and account access for the selected provider.";
  }

  if (status === 400) {
    return `Provider rejected the request (400). Check model/provider compatibility and request format. ${error.message}`;
  }

  if (status != null) {
    return `AI provider call failed with status ${status}. ${error.message}`;
  }

  return `AI provider call failed. ${error.message}`;
};

export const formatAiError = (error: unknown): string => {
  if (NoSuchModelError.isInstance(error)) {
    return `Unknown model for selected provider. Check \`SHIPIT_PROVIDER\` and \`SHIPIT_MODEL\`. ${error.message}`;
  }

  if (LoadAPIKeyError.isInstance(error)) {
    return `Missing or invalid API key configuration. ${error.message}`;
  }

  if (LoadSettingError.isInstance(error)) {
    return `Invalid AI SDK/provider settings. ${error.message}`;
  }

  if (APICallError.isInstance(error)) {
    return formatApiCallError(error);
  }

  if (RetryError.isInstance(error)) {
    const lastError = error.lastError;
    if (APICallError.isInstance(lastError)) {
      return `AI request failed after retries. ${formatApiCallError(lastError)}`;
    }
    return `AI request failed after retries. ${error.message}`;
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    if (JSONParseError.isInstance(error.cause)) {
      return "Provider returned malformed structured output. Retry, split the diff, or switch model/provider.";
    }

    if (TypeValidationError.isInstance(error.cause)) {
      return "Provider output did not match the expected schema. Retry, split the diff, or switch model/provider.";
    }

    return "Provider did not return valid structured output. Retry or use a different model/provider.";
  }

  if (JSONParseError.isInstance(error)) {
    return "Provider returned malformed JSON output. Retry or switch model/provider.";
  }

  if (TypeValidationError.isInstance(error)) {
    return "Provider returned data that failed schema validation. Retry or switch model/provider.";
  }

  return getErrorMessage(error);
};
