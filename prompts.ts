import * as clack from "@clack/prompts";

export type Prompts = typeof clack;

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
