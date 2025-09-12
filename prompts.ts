import * as clack from "@clack/prompts";

export type Prompts = typeof clack & {
  progressGroup: (
    operations: Array<{ name: string; action: () => Promise<void> }>,
  ) => Promise<void>;
};

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
export function createPrompts({ silent = false, force = false }): Prompts {
  const progressGroup = async (
    operations: Array<{ name: string; action: () => Promise<void> }>,
  ) => {
    if (silent) {
      // In silent mode, just execute operations without any UI
      for (const op of operations) {
        await op.action();
      }
      return;
    }

    const spinner = clack.spinner();
    let currentIndex = 0;

    const updateSpinner = () => {
      const current = operations[currentIndex];
      if (current) {
        const progress = `(${currentIndex + 1}/${operations.length})`;
        spinner.start(`${current.name} ${progress}`);
      }
    };

    updateSpinner();

    for (const operation of operations) {
      try {
        await operation.action();
        currentIndex++;
        if (currentIndex < operations.length) {
          updateSpinner();
        }
      } catch (error) {
        spinner.stop(`Failed: ${operation.name}`);
        throw error;
      }
    }

    spinner.stop(`✓ Completed ${operations.length} operations`);
  };

  if (silent) {
    return {
      ...clack,

      // A proxy is used to intercept all methods of `clack.log`
      // and replace them with a no-op, except for the `error` method.
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

      progressGroup,

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
      progressGroup,
      confirm: new Proxy(clack.confirm, {
        apply: () => Promise.resolve(true),
      }),
    };
  }

  return { ...clack, progressGroup };
}
