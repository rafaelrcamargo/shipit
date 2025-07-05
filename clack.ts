import * as clack from "@clack/prompts";

export function createClack({ silent = false, force = false }): typeof clack {
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
