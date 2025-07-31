import * as clack from "@clack/prompts";

/**
 * Wraps the `@clack/prompts` library to conditionally suppress or auto-confirm prompts.
 * This enables a "silent" mode where all output (except errors) is hidden, and a "force"
 * mode where all confirmation prompts are automatically accepted.
 *
 * @param options - Configuration for the wrapper.
 * @param options.silent - If true, suppress all logging and prompts except for errors.
 * @param options.force - If true, automatically confirm all prompts.
 * @returns A clack instance, which may be a proxied version of the original.
 */
export function createPrompts({ silent = false, force = false }): typeof clack {
  if (silent) {
    return {
      ...clack,

      log: new Proxy(clack.log, {
        get(target, prop) {
          if (prop !== "error") return () => {};
          return target[prop as keyof typeof target];
        },
      }),

      note: () => {},
      outro: () => {},

      spinner: () => ({
        start: () => {},
        stop: () => {},
        message: () => {},
        isCancelled: false,
      }),

      confirm: force
        ? new Proxy(clack.confirm, {
            apply: () => Promise.resolve(true),
          })
        : clack.confirm,
    };
  }

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
