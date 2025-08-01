import type { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { simpleGit } from "simple-git";
import type { createPrompts } from "./prompts";

export type Log = ReturnType<typeof createPrompts>["log"];
export type Spinner = ReturnType<typeof createPrompts>["spinner"];
export type Confirm = ReturnType<typeof createPrompts>["confirm"];
export type Git = ReturnType<typeof simpleGit>;
export type Google = ReturnType<typeof createGoogleGenerativeAI>;

export type BaseHandlerParams = {
  git: Git;
  log: Log;
  spinner: Spinner;
};

export type PushHandlerParams = BaseHandlerParams;

export type PrHandlerParams = BaseHandlerParams & {
  confirm: Confirm;
  options: { [key: string]: boolean };
  google: Google;
};
