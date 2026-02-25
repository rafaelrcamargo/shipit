import * as clack from "@clack/prompts";

export type Prompts = typeof clack;

/**
 * Wraps the `@clack/prompts` library to conditionally auto-confirm prompts.
 * This enables a "force" mode where all confirmation prompts are automatically accepted.
 *
 * @param options - Configuration for the wrapper.
 * @param options.force - If true, automatically confirm all prompts.
 * @returns A clack instance, which may be a proxied version of the original.
 */
export function createPrompts({ force = false }): Prompts {
  if (force) {
    return {
      ...clack,
      confirm: new Proxy(clack.confirm, {
        apply: () => Promise.resolve(true),
      }),
    };
  }

  return clack;
}
