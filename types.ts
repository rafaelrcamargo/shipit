type Expand<T> = { [K in keyof T]: T[K] } & {};

export type ResponseSchema = Expand<
  {
    files: string[];
    type:
      | "fix"
      | "feat"
      | "build"
      | "chore"
      | "ci"
      | "docs"
      | "style"
      | "refactor"
      | "perf"
      | "test"
      | "other";
    scope?: string;
    description: string;
    body?: string;
    breaking: boolean;
    footers?: string[];
  }[]
>;
