import { LinearClient, type Issue } from "@linear/sdk";
import type { SimpleGit, DefaultLogFields, ListLogLine } from "simple-git";

import type { ChangeSet } from "./changes";
import { isNoisyPath } from "./changes";
import { getBaseBranch } from "./utils";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

export const GITHUB_CONTEXT_DISABLE_ENV = "SHIPIT_DISABLE_GH";

export const isGithubContextDisabled = (
  env: Record<string, string | undefined> = process.env,
) => env[GITHUB_CONTEXT_DISABLE_ENV]?.trim() === "1";

export type RepoCommitContext = {
  hash: string;
  message: string;
  body?: string;
};

export type ChangedFileContext = {
  path: string;
  fromPath?: string;
  status: string;
  insertions?: number;
  deletions?: number;
  isBinary: boolean;
  isNoisy: boolean;
};

export type GithubContext = {
  isAvailable: boolean;
  omittedReason?: string;
  existingPr?: {
    number?: number;
    title?: string;
    body?: string;
    url?: string;
  };
  repository?: {
    nameWithOwner?: string;
    description?: string;
    url?: string;
  };
  linkedIssues: {
    number?: number;
    title?: string;
    state?: string;
    url?: string;
  }[];
};

export type LinearIssueContext = {
  identifier: string;
  title: string;
  description?: string;
  state?: string;
  priority?: number;
  priorityLabel?: string;
  assignee?: string;
  labels: string[];
  url?: string;
};

export type LinearContext = {
  isAvailable: boolean;
  omittedReason?: string;
  issues: LinearIssueContext[];
};

export type RepoContext = {
  branch?: string;
  baseBranch?: string;
  baseRef?: string;
  remoteUrl?: string;
  mergeBase?: string;
  ticketIds: string[];
  commits: RepoCommitContext[];
  diff: {
    stat?: string;
    numstat?: string;
    nameStatus?: string;
  };
  changedFiles: ChangedFileContext[];
  github: GithubContext;
  linear: LinearContext;
  omittedReasons: string[];
};

export type LinearIssueFetcher = (
  apiKey: string,
  identifiers: string[],
  branch?: string,
) => Promise<LinearIssueContext[]>;

type CollectRepoContextOptions = {
  baseBranch?: string;
  changeSet?: ChangeSet;
  selectedPaths?: string[];
  includeGithub?: boolean;
  includeLinear?: boolean;
  linearApiKey?: string;
  ticketIds?: string[];
  linearIssueFetcher?: LinearIssueFetcher;
  maxCommits?: number;
  maxCommitBodyChars?: number;
  maxGithubBodyChars?: number;
  maxLinearDescriptionChars?: number;
  maxContextChars?: number;
  commandRunner?: CommandRunner;
  env?: Record<string, string | undefined>;
};

const defaultCommandRunner: CommandRunner = async (command, args) => {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    code,
    stdout,
    stderr,
  };
};

const truncateText = (value: string | undefined, maxChars: number) => {
  if (!value) return undefined;
  return value.length > maxChars ? value.slice(0, maxChars) : value;
};

const tryGitString = async (
  getValue: () => Promise<string>,
): Promise<string | undefined> => {
  try {
    const value = await getValue();
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
};

const getBestBaseRef = async (
  git: SimpleGit,
  baseBranch: string | undefined,
): Promise<string | undefined> => {
  if (!baseBranch) return undefined;

  const originRef = `origin/${baseBranch}`;
  const hasOriginRef = await tryGitString(() =>
    git.revparse(["--verify", originRef]),
  );
  if (hasOriginRef) return originRef;

  const hasLocalRef = await tryGitString(() =>
    git.revparse(["--verify", baseBranch]),
  );
  return hasLocalRef ? baseBranch : undefined;
};

const parseNumstat = (numstat: string) => {
  const byPath = new Map<
    string,
    Pick<ChangedFileContext, "insertions" | "deletions" | "isBinary">
  >();

  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [insertionsRaw, deletionsRaw, path] = line.split("\t");
    if (!path) continue;

    const isBinary = insertionsRaw === "-" || deletionsRaw === "-";
    byPath.set(path, {
      insertions: isBinary ? undefined : Number(insertionsRaw),
      deletions: isBinary ? undefined : Number(deletionsRaw),
      isBinary,
    });
  }

  return byPath;
};

const parseNameStatus = (nameStatus: string, numstat: string) => {
  const statsByPath = parseNumstat(numstat);
  const files: ChangedFileContext[] = [];

  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, firstPath, secondPath] = line.split("\t");
    if (!status || !firstPath) continue;

    const path = secondPath ?? firstPath;
    const stats = statsByPath.get(path);
    files.push({
      path,
      fromPath: secondPath ? firstPath : undefined,
      status,
      insertions: stats?.insertions,
      deletions: stats?.deletions,
      isBinary: stats?.isBinary ?? false,
      isNoisy: isNoisyPath(path),
    });
  }

  return files;
};

const getChangedFilesFromChangeSet = (
  changeSet: ChangeSet,
): ChangedFileContext[] =>
  changeSet.changes.map((change) => ({
    path: change.path,
    fromPath: change.fromPath,
    status: change.kind,
    insertions: change.evidence.stats?.insertions,
    deletions: change.evidence.stats?.deletions,
    isBinary:
      change.evidence.isBinary || change.evidence.stats?.isBinary === true,
    isNoisy: isNoisyPath(change.path),
  }));

const collectCommits = async (
  git: SimpleGit,
  baseRef: string | undefined,
  maxCommits: number,
  maxCommitBodyChars: number,
): Promise<RepoCommitContext[]> => {
  if (!baseRef) return [];

  try {
    const log = await git.log([
      `${baseRef}..HEAD`,
      `--max-count=${maxCommits}`,
    ]);
    return log.all.map((commit: DefaultLogFields & ListLogLine) => ({
      hash: commit.hash.slice(0, 12),
      message: commit.message,
      body: truncateText(commit.body?.trim(), maxCommitBodyChars),
    }));
  } catch {
    return [];
  }
};

const collectGitDiffContext = async (
  git: SimpleGit,
  baseRef: string | undefined,
  selectedPaths: string[],
) => {
  if (!baseRef) {
    return {
      stat: undefined,
      numstat: undefined,
      nameStatus: undefined,
      changedFiles: [] as ChangedFileContext[],
    };
  }

  const pathArgs = selectedPaths.length > 0 ? ["--", ...selectedPaths] : [];
  const diffArgs = [`${baseRef}..HEAD`, ...pathArgs];
  const [stat, numstat, nameStatus] = await Promise.all([
    tryGitString(() => git.diff(["--stat", ...diffArgs])),
    tryGitString(() => git.diff(["--numstat", ...diffArgs])),
    tryGitString(() => git.diff(["--name-status", ...diffArgs])),
  ]);

  return {
    stat,
    numstat,
    nameStatus,
    changedFiles: parseNameStatus(nameStatus ?? "", numstat ?? ""),
  };
};

const parseJson = <Value>(value: string): Value | undefined => {
  try {
    return JSON.parse(value) as Value;
  } catch {
    return undefined;
  }
};

const runGhJson = async <Value>(
  runner: CommandRunner,
  args: string[],
): Promise<Value | undefined> => {
  const result = await runner("gh", args);
  if (result.code !== 0) return undefined;
  return parseJson<Value>(result.stdout);
};

const issueRefsFromText = (value: string): number[] => {
  const issueNumbers = new Set<number>();
  const pattern =
    /(?:^|[\s([#])#(\d+)\b|(?:^|[\s(/_-])(?:issue|issues)-?(\d+)\b/gi;

  for (const match of value.matchAll(pattern)) {
    const raw = match[1] ?? match[2];
    const issueNumber = raw ? Number(raw) : Number.NaN;
    if (Number.isInteger(issueNumber)) issueNumbers.add(issueNumber);
  }

  return Array.from(issueNumbers).slice(0, 3);
};

const linearRefsFromText = (value: string): string[] => {
  const refs = new Set<string>();
  const pattern = /\b([A-Z][A-Z0-9]+-\d+)\b/gi;

  for (const match of value.matchAll(pattern)) {
    if (!match[1]) continue;
    const [key] = match[1].split("-");
    if (key === undefined || ["ISSUE", "ISSUES"].includes(key.toUpperCase()))
      continue;
    refs.add(match[1].toUpperCase());
  }

  return Array.from(refs).slice(0, 3);
};

const uniqueLinearIssues = (
  issues: (LinearIssueContext | undefined)[],
): LinearIssueContext[] => {
  const seen = new Set<string>();
  const unique: LinearIssueContext[] = [];

  for (const issue of issues) {
    if (!issue || seen.has(issue.identifier)) continue;
    seen.add(issue.identifier);
    unique.push(issue);
  }

  return unique;
};

const summarizeLinearIssue = async (
  issue: Issue | undefined,
  maxDescriptionChars: number,
): Promise<LinearIssueContext | undefined> => {
  if (!issue) return undefined;

  const [state, assignee, labels] = await Promise.all([
    issue.state?.catch(() => undefined),
    issue.assignee?.catch(() => undefined),
    issue
      .labels({ first: 10 })
      .then((connection) => connection.nodes.map((label) => label.name))
      .catch(() => [] as string[]),
  ]);

  return {
    identifier: issue.identifier,
    title: issue.title,
    description: truncateText(
      issue.description?.trim() ?? undefined,
      maxDescriptionChars,
    ),
    state: state?.name,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    assignee: assignee?.displayName,
    labels,
    url: issue.url,
  };
};

const defaultLinearIssueFetcher =
  (maxDescriptionChars: number): LinearIssueFetcher =>
  async (apiKey, identifiers, branch) => {
    const client = new LinearClient({ apiKey });
    const issues: (LinearIssueContext | undefined)[] = [];

    if (branch) {
      issues.push(
        await summarizeLinearIssue(
          await client.issueVcsBranchSearch(branch),
          maxDescriptionChars,
        ),
      );
    }

    if (identifiers.length > 0) {
      const issueConnection = await client.issues({
        filter: { id: { in: identifiers } },
        first: identifiers.length,
      });

      issues.push(
        ...(await Promise.all(
          issueConnection.nodes.map((issue) =>
            summarizeLinearIssue(issue, maxDescriptionChars),
          ),
        )),
      );
    }

    return uniqueLinearIssues(issues);
  };

const collectGithubContext = async ({
  branch,
  commits,
  maxGithubBodyChars,
  runner,
}: {
  branch?: string;
  commits: RepoCommitContext[];
  maxGithubBodyChars: number;
  runner: CommandRunner;
}): Promise<GithubContext> => {
  try {
    const authStatus = await runner("gh", ["auth", "status"]);
    if (authStatus.code !== 0) {
      return {
        isAvailable: false,
        omittedReason: "GitHub CLI is not authenticated",
        linkedIssues: [],
      };
    }

    const [existingPr, repository] = await Promise.all([
      runGhJson<{
        number?: number;
        title?: string;
        body?: string;
        url?: string;
      }>(runner, ["pr", "view", "--json", "number,title,body,url"]),
      runGhJson<{
        nameWithOwner?: string;
        description?: string;
        url?: string;
      }>(runner, ["repo", "view", "--json", "nameWithOwner,description,url"]),
    ]);

    const refText = [branch, ...commits.map((commit) => commit.message)]
      .filter(Boolean)
      .join("\n");
    const linkedIssues = (
      await Promise.all(
        issueRefsFromText(refText).map((issueNumber) =>
          runGhJson<{
            number?: number;
            title?: string;
            state?: string;
            url?: string;
          }>(runner, [
            "issue",
            "view",
            String(issueNumber),
            "--json",
            "number,title,state,url",
          ]),
        ),
      )
    ).filter(
      (issue): issue is NonNullable<typeof issue> => issue !== undefined,
    );

    return {
      isAvailable: true,
      existingPr: existingPr
        ? {
            ...existingPr,
            body: truncateText(existingPr.body, maxGithubBodyChars),
          }
        : undefined,
      repository,
      linkedIssues,
    };
  } catch (error) {
    return {
      isAvailable: false,
      omittedReason: error instanceof Error ? error.message : String(error),
      linkedIssues: [],
    };
  }
};

const collectLinearContext = async ({
  apiKey,
  branch,
  commits,
  ticketIds,
  fetcher,
}: {
  apiKey?: string;
  branch?: string;
  commits: RepoCommitContext[];
  ticketIds: string[];
  fetcher: LinearIssueFetcher;
}): Promise<LinearContext> => {
  if (!apiKey?.trim()) {
    return {
      isAvailable: false,
      omittedReason: "LINEAR_API_KEY is not configured",
      issues: [],
    };
  }

  const refText = [
    branch,
    ...commits.map((commit) => `${commit.message}\n${commit.body ?? ""}`),
  ]
    .filter(Boolean)
    .join("\n");
  const identifiers = Array.from(
    new Set([...ticketIds, ...linearRefsFromText(refText)]),
  );
  const branchName = branch === "HEAD" ? undefined : branch;

  if (!branchName && identifiers.length === 0) {
    return {
      isAvailable: true,
      omittedReason: "no Linear branch or issue identifiers found",
      issues: [],
    };
  }

  try {
    const issues = await fetcher(apiKey, identifiers, branchName);
    return {
      isAvailable: true,
      omittedReason:
        issues.length === 0 ? "no matching Linear issues found" : undefined,
      issues,
    };
  } catch (error) {
    return {
      isAvailable: false,
      omittedReason: error instanceof Error ? error.message : String(error),
      issues: [],
    };
  }
};

const contextSize = (context: RepoContext): number =>
  JSON.stringify(context).length;

const budgetRepoContext = (
  context: RepoContext,
  maxContextChars: number,
): RepoContext => {
  let budgeted = context;
  if (contextSize(budgeted) <= maxContextChars) return budgeted;

  if (budgeted.github.existingPr?.body) {
    budgeted = {
      ...budgeted,
      github: {
        ...budgeted.github,
        existingPr: {
          ...budgeted.github.existingPr,
          body: truncateText(budgeted.github.existingPr.body, 1000),
        },
      },
      omittedReasons: [
        ...budgeted.omittedReasons,
        "existing PR body truncated to fit context budget",
      ],
    };
  }
  if (contextSize(budgeted) <= maxContextChars) return budgeted;

  if (budgeted.linear.issues.some((issue) => issue.description)) {
    budgeted = {
      ...budgeted,
      linear: {
        ...budgeted.linear,
        issues: budgeted.linear.issues.map((issue) => ({
          ...issue,
          description: truncateText(issue.description, 1000),
        })),
      },
      omittedReasons: [
        ...budgeted.omittedReasons,
        "Linear issue descriptions truncated to fit context budget",
      ],
    };
  }
  if (contextSize(budgeted) <= maxContextChars) return budgeted;

  if (budgeted.linear.issues.some((issue) => issue.description)) {
    budgeted = {
      ...budgeted,
      linear: {
        ...budgeted.linear,
        issues: budgeted.linear.issues.map(
          ({ description: _description, ...issue }) => issue,
        ),
      },
      omittedReasons: [
        ...budgeted.omittedReasons,
        "Linear issue descriptions omitted to fit context budget",
      ],
    };
  }
  if (contextSize(budgeted) <= maxContextChars) return budgeted;

  if (budgeted.commits.some((commit) => commit.body)) {
    budgeted = {
      ...budgeted,
      commits: budgeted.commits.map((commit) => ({
        hash: commit.hash,
        message: commit.message,
      })),
      omittedReasons: [
        ...budgeted.omittedReasons,
        "commit bodies omitted to fit context budget",
      ],
    };
  }
  if (contextSize(budgeted) <= maxContextChars) return budgeted;

  budgeted = {
    ...budgeted,
    diff: {
      stat: truncateText(budgeted.diff.stat, 8000),
      numstat: truncateText(budgeted.diff.numstat, 8000),
      nameStatus: truncateText(budgeted.diff.nameStatus, 8000),
    },
    omittedReasons: [
      ...budgeted.omittedReasons,
      "diff summaries truncated to fit context budget",
    ],
  };
  if (contextSize(budgeted) <= maxContextChars) return budgeted;

  return {
    ...budgeted,
    changedFiles: budgeted.changedFiles.slice(0, 200),
    omittedReasons: [
      ...budgeted.omittedReasons,
      "changed file list truncated to fit context budget",
    ],
  };
};

export const collectRepoContext = async (
  git: SimpleGit,
  options: CollectRepoContextOptions = {},
): Promise<RepoContext> => {
  const selectedPaths = options.selectedPaths ?? [];
  const ticketIds = options.ticketIds ?? [];
  const maxCommits = options.maxCommits ?? 20;
  const maxCommitBodyChars = options.maxCommitBodyChars ?? 500;
  const maxGithubBodyChars = options.maxGithubBodyChars ?? 3000;
  const maxLinearDescriptionChars = options.maxLinearDescriptionChars ?? 3000;
  const maxContextChars = options.maxContextChars ?? 50000;
  const runner = options.commandRunner ?? defaultCommandRunner;
  const env = options.env ?? process.env;
  const omittedReasons: string[] = [];

  const [branch, remoteConfigValue] = await Promise.all([
    tryGitString(() => git.revparse(["--abbrev-ref", "HEAD"])),
    git.getConfig("remote.origin.url").catch(() => ({ value: undefined })),
  ]);
  const remoteUrl = remoteConfigValue.value ?? undefined;

  const baseBranch =
    options.baseBranch ?? (await getBaseBranch(git).catch(() => undefined));
  const baseRef = await getBestBaseRef(git, baseBranch);
  const mergeBase = await tryGitString(() =>
    baseRef ? git.raw(["merge-base", baseRef, "HEAD"]) : Promise.resolve(""),
  );
  if (baseBranch && !baseRef) {
    omittedReasons.push(`base ref for ${baseBranch} was not found`);
  }

  const [commits, gitDiffContext] = await Promise.all([
    collectCommits(git, baseRef, maxCommits, maxCommitBodyChars),
    collectGitDiffContext(git, baseRef, selectedPaths),
  ]);

  const githubContextDisabled = isGithubContextDisabled(env);
  const github =
    options.includeGithub === false || githubContextDisabled
      ? {
          isAvailable: false,
          omittedReason: githubContextDisabled
            ? `${GITHUB_CONTEXT_DISABLE_ENV}=1`
            : "GitHub context disabled",
          linkedIssues: [],
        }
      : await collectGithubContext({
          branch,
          commits,
          maxGithubBodyChars,
          runner,
        });
  const linear =
    options.includeLinear === false
      ? {
          isAvailable: false,
          omittedReason: "Linear context disabled",
          issues: [],
        }
      : await collectLinearContext({
          apiKey: options.linearApiKey ?? env["LINEAR_API_KEY"],
          branch,
          commits,
          ticketIds,
          fetcher:
            options.linearIssueFetcher ??
            defaultLinearIssueFetcher(maxLinearDescriptionChars),
        });

  return budgetRepoContext(
    {
      branch,
      baseBranch,
      baseRef,
      remoteUrl,
      mergeBase,
      ticketIds,
      commits,
      diff: {
        stat: gitDiffContext.stat,
        numstat: gitDiffContext.numstat,
        nameStatus: gitDiffContext.nameStatus,
      },
      changedFiles:
        options.changeSet !== undefined
          ? getChangedFilesFromChangeSet(options.changeSet)
          : gitDiffContext.changedFiles,
      github,
      linear,
      omittedReasons,
    },
    maxContextChars,
  );
};

export const serializeRepoContextForPrompt = (context: RepoContext) => ({
  branch: context.branch,
  baseBranch: context.baseBranch,
  baseRef: context.baseRef,
  remoteUrl: context.remoteUrl,
  mergeBase: context.mergeBase,
  ...(context.ticketIds.length > 0 ? { ticketIds: context.ticketIds } : {}),
  commits: context.commits,
  diff: context.diff,
  changedFiles: context.changedFiles,
  github: context.github,
  ...(context.linear.issues.length > 0 ? { linear: context.linear } : {}),
  omittedReasons: context.omittedReasons,
});
