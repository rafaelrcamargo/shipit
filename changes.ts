import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SimpleGit } from "simple-git";

export type ChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked";

export type PorcelainEntry =
  | {
      type: "ordinary";
      xy: string;
      submodule: string;
      headMode: string;
      indexMode: string;
      worktreeMode: string;
      headHash: string;
      indexHash: string;
      path: string;
    }
  | {
      type: "renamed";
      xy: string;
      submodule: string;
      headMode: string;
      indexMode: string;
      worktreeMode: string;
      headHash: string;
      indexHash: string;
      score: string;
      path: string;
      fromPath: string;
    }
  | {
      type: "untracked";
      path: string;
    }
  | {
      type: "unmerged";
      xy: string;
      path: string;
      raw: string;
    };

export type ChangeEvidence = {
  summary: string;
  diff?: string;
  content?: string;
  stats?: {
    insertions?: number;
    deletions?: number;
    isBinary: boolean;
  };
  isNoisy: boolean;
  isBinary: boolean;
  isTruncated: boolean;
  isSummaryOnly: boolean;
  isUnavailable: boolean;
  summaryReason?: string;
  truncationReason?: string;
  unavailableReason?: string;
};

export type GitChange = {
  id: string;
  identity: string;
  kind: ChangeKind;
  path: string;
  fromPath?: string;
  indexState: string;
  worktreeState: string;
  headHash?: string;
  indexHash?: string;
  stagePathspecs: string[];
  commitPathspecs: string[];
  evidence: ChangeEvidence;
  fingerprint: string;
};

export type ChangeSet = {
  selectedPaths: string[];
  changes: GitChange[];
  allChanges: GitChange[];
  conflicts: PorcelainEntry[];
  stagedOutsideSelectedChanges: GitChange[];
  fingerprint: string;
  counts: Record<ChangeKind, number>;
};

export type CommitCoverageIssue = {
  ok: boolean;
  missing: string[];
  duplicated: string[];
  unexpected: string[];
};

type CommitChangeGroup = {
  changeIds: readonly string[];
};

type EvidenceOptions = {
  maxDiffChars?: number;
  maxUntrackedContentBytes?: number;
};

const emptyEvidence = (summary: string): ChangeEvidence => ({
  summary,
  isNoisy: false,
  isBinary: false,
  isTruncated: false,
  isSummaryOnly: false,
  isUnavailable: false,
});

const normalizePath = (path: string): string => path.replace(/\\/g, "/");

const noisyPathPatterns = [
  /^bun\.lockb?$/,
  /^package-lock\.json$/,
  /^npm-shrinkwrap\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^Cargo\.lock$/,
  /^go\.sum$/,
  /^poetry\.lock$/,
  /^uv\.lock$/,
  /^Gemfile\.lock$/,
  /\.min\.js$/,
  /\.map$/,
] as const;

export const isNoisyPath = (path: string): boolean =>
  noisyPathPatterns.some((pattern) =>
    pattern.test(path.split("/").at(-1) ?? path),
  );

const toWorkingTreePath = (repoRoot: string, path: string): string =>
  join(repoRoot, path);

const getChangeIdentity = ({
  kind,
  path,
  fromPath,
}: Pick<GitChange, "kind" | "path" | "fromPath">): string =>
  [kind, fromPath ?? "", path].join("\0");

const getChangeTitle = (
  change: Pick<GitChange, "kind" | "path" | "fromPath">,
) =>
  change.fromPath
    ? `${change.kind}: ${change.fromPath} -> ${change.path}`
    : `${change.kind}: ${change.path}`;

const getKindFromOrdinaryStatus = (
  indexState: string,
  worktreeState: string,
): ChangeKind => {
  if (indexState === "A") return "added";
  if (indexState === "D" || worktreeState === "D") return "deleted";
  return "modified";
};

const hasStagedChange = (change: GitChange): boolean =>
  change.indexState !== "." &&
  change.indexState !== " " &&
  change.indexState !== "?";

const parseOrdinaryEntry = (record: string): PorcelainEntry => {
  const match = /^1 (..) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/.exec(
    record,
  );
  if (!match) throw new Error(`Invalid porcelain v2 ordinary entry: ${record}`);

  return {
    type: "ordinary",
    xy: match[1] ?? "",
    submodule: match[2] ?? "",
    headMode: match[3] ?? "",
    indexMode: match[4] ?? "",
    worktreeMode: match[5] ?? "",
    headHash: match[6] ?? "",
    indexHash: match[7] ?? "",
    path: normalizePath(match[8] ?? ""),
  };
};

const parseRenamedEntry = (
  record: string,
  fromPath: string | undefined,
): PorcelainEntry => {
  const match =
    /^2 (..) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) ([RC]\d+) (.*)$/.exec(record);
  if (!match || !fromPath) {
    throw new Error(`Invalid porcelain v2 rename/copy entry: ${record}`);
  }

  return {
    type: "renamed",
    xy: match[1] ?? "",
    submodule: match[2] ?? "",
    headMode: match[3] ?? "",
    indexMode: match[4] ?? "",
    worktreeMode: match[5] ?? "",
    headHash: match[6] ?? "",
    indexHash: match[7] ?? "",
    score: match[8] ?? "",
    path: normalizePath(match[9] ?? ""),
    fromPath: normalizePath(fromPath),
  };
};

const parseUnmergedEntry = (record: string): PorcelainEntry => {
  const match = /^u (..) (?:\S+ ){8}(.*)$/.exec(record);

  return {
    type: "unmerged",
    xy: match?.[1] ?? "UU",
    path: normalizePath(match?.[2] ?? record.split(" ").at(-1) ?? ""),
    raw: record,
  };
};

export const parsePorcelainV2 = (output: string): PorcelainEntry[] => {
  const records = output.split("\0");
  const entries: PorcelainEntry[] = [];

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("1 ")) {
      entries.push(parseOrdinaryEntry(record));
    } else if (record.startsWith("2 ")) {
      entries.push(parseRenamedEntry(record, records[index + 1]));
      index++;
    } else if (record.startsWith("? ")) {
      entries.push({
        type: "untracked",
        path: normalizePath(record.slice(2)),
      });
    } else if (record.startsWith("u ")) {
      entries.push(parseUnmergedEntry(record));
    }
  }

  return entries;
};

const entryToChange = (entry: PorcelainEntry): GitChange | null => {
  if (entry.type === "unmerged") return null;

  if (entry.type === "untracked") {
    const change = {
      id: "",
      identity: "",
      kind: "untracked" as const,
      path: entry.path,
      indexState: "?",
      worktreeState: "?",
      stagePathspecs: [entry.path],
      commitPathspecs: [entry.path],
      evidence: emptyEvidence(`untracked: ${entry.path}`),
      fingerprint: "",
    };

    return {
      ...change,
      identity: getChangeIdentity(change),
    };
  }

  if (entry.type === "renamed") {
    const kind: ChangeKind = entry.score.startsWith("C") ? "copied" : "renamed";
    const change = {
      id: "",
      identity: "",
      kind,
      path: entry.path,
      fromPath: entry.fromPath,
      indexState: entry.xy[0] ?? ".",
      worktreeState: entry.xy[1] ?? ".",
      headHash: entry.headHash,
      indexHash: entry.indexHash,
      stagePathspecs: [entry.path],
      commitPathspecs:
        kind === "renamed" ? [entry.fromPath, entry.path] : [entry.path],
      evidence: emptyEvidence(`${kind}: ${entry.fromPath} -> ${entry.path}`),
      fingerprint: "",
    };

    return {
      ...change,
      identity: getChangeIdentity(change),
    };
  }

  const indexState = entry.xy[0] ?? ".";
  const worktreeState = entry.xy[1] ?? ".";
  const kind: ChangeKind = getKindFromOrdinaryStatus(indexState, worktreeState);
  const change = {
    id: "",
    identity: "",
    kind,
    path: entry.path,
    indexState,
    worktreeState,
    headHash: entry.headHash,
    indexHash: entry.indexHash,
    stagePathspecs: [entry.path],
    commitPathspecs: [entry.path],
    evidence: emptyEvidence(`${kind}: ${entry.path}`),
    fingerprint: "",
  };

  return {
    ...change,
    identity: getChangeIdentity(change),
  };
};

const entriesToChanges = (entries: PorcelainEntry[]): GitChange[] =>
  entries
    .map(entryToChange)
    .filter((change): change is GitChange => change !== null);

const findFullChangeForSelectedChange = (
  selectedChange: GitChange,
  fullChanges: GitChange[],
): GitChange =>
  fullChanges.find(
    (change) =>
      change.path === selectedChange.path ||
      change.fromPath === selectedChange.path ||
      (selectedChange.fromPath !== undefined &&
        (change.path === selectedChange.fromPath ||
          change.fromPath === selectedChange.fromPath)),
  ) ?? selectedChange;

const runStatusPorcelain = async (
  git: SimpleGit,
  selectedPaths: string[],
): Promise<PorcelainEntry[]> => {
  const output = await git.raw([
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    ...(selectedPaths.length > 0 ? ["--", ...selectedPaths] : []),
  ]);

  return parsePorcelainV2(output);
};

const truncate = (
  value: string,
  maxChars: number,
): { value: string; isTruncated: boolean } => ({
  value: value.length > maxChars ? value.slice(0, maxChars) : value,
  isTruncated: value.length > maxChars,
});

const parseNumstatLine = (
  output: string,
): ChangeEvidence["stats"] | undefined => {
  const [insertionsRaw, deletionsRaw] = output.split("\t");
  if (!insertionsRaw || !deletionsRaw) return undefined;

  const isBinary = insertionsRaw === "-" || deletionsRaw === "-";
  return {
    insertions: isBinary ? undefined : Number(insertionsRaw),
    deletions: isBinary ? undefined : Number(deletionsRaw),
    isBinary,
  };
};

const readBoundedTextFile = async (
  repoRoot: string,
  path: string,
  maxBytes: number,
): Promise<Pick<ChangeEvidence, "content" | "isBinary" | "isTruncated">> => {
  const handle = await open(toWorkingTreePath(repoRoot, path), "r");

  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, Math.min(bytesRead, maxBytes));

    if (bytes.includes(0)) {
      return {
        content: "[binary file summary only]",
        isBinary: true,
        isTruncated: false,
      };
    }

    return {
      content: bytes.toString("utf8"),
      isBinary: false,
      isTruncated: bytesRead > maxBytes,
    };
  } finally {
    await handle.close();
  }
};

const hashFile = async (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (error) => reject(error));
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const getFileFingerprint = async (
  repoRoot: string,
  path: string,
): Promise<string> => {
  try {
    const absolutePath = toWorkingTreePath(repoRoot, path);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) return `not-file:${fileStat.size}`;

    return `file:${fileStat.size}:${await hashFile(absolutePath)}`;
  } catch {
    return "missing";
  }
};

const getChangeFingerprint = async (
  repoRoot: string,
  change: GitChange,
): Promise<string> => {
  const pathFingerprint = await getFileFingerprint(repoRoot, change.path);
  const fromPathFingerprint =
    change.fromPath !== undefined
      ? await getFileFingerprint(repoRoot, change.fromPath)
      : undefined;

  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: change.kind,
        path: change.path,
        fromPath: change.fromPath,
        indexState: change.indexState,
        worktreeState: change.worktreeState,
        headHash: change.headHash,
        indexHash: change.indexHash,
        pathFingerprint,
        fromPathFingerprint,
      }),
    )
    .digest("hex");
};

const attachEvidence = async (
  git: SimpleGit,
  repoRoot: string,
  change: GitChange,
  options: Required<EvidenceOptions>,
): Promise<GitChange> => {
  const isNoisy = isNoisyPath(change.path);
  let evidence = {
    ...emptyEvidence(getChangeTitle(change)),
    isNoisy,
  };

  if (change.kind === "untracked") {
    try {
      const content = await readBoundedTextFile(
        repoRoot,
        change.path,
        options.maxUntrackedContentBytes,
      );
      const isBinary = content.isBinary;
      const isSummaryOnly = isNoisy || isBinary;
      evidence = {
        ...evidence,
        ...content,
        content: isSummaryOnly ? undefined : content.content,
        isBinary,
        isTruncated: content.isTruncated,
        isSummaryOnly,
        summaryReason: isNoisy
          ? "text content summarized because file is treated as noisy/generated"
          : isBinary
            ? "binary file summarized without raw content"
            : undefined,
        truncationReason: content.isTruncated
          ? "text content truncated to fit per-file evidence budget"
          : undefined,
      };
    } catch (error) {
      evidence = {
        ...evidence,
        isUnavailable: true,
        unavailableReason:
          error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    const [rawDiff, numstat] = await Promise.all([
      isNoisy
        ? Promise.resolve("")
        : git.diff(["HEAD", "--", ...change.commitPathspecs]),
      git.diff(["--numstat", "HEAD", "--", ...change.commitPathspecs]),
    ]);
    const diff = truncate(rawDiff, options.maxDiffChars);
    const stats = parseNumstatLine(numstat);
    const isBinary = stats?.isBinary ?? false;
    const hasTextualDiff = rawDiff.trim().length > 0;
    const isSummaryOnly = isNoisy || isBinary;
    evidence = {
      ...evidence,
      stats,
      diff: isSummaryOnly || !hasTextualDiff ? undefined : diff.value,
      isBinary,
      isTruncated: isSummaryOnly ? false : diff.isTruncated,
      isSummaryOnly,
      isUnavailable: !isSummaryOnly && !hasTextualDiff,
      summaryReason: isNoisy
        ? "text diff summarized because file is treated as noisy/generated"
        : isBinary
          ? "binary file summarized without raw diff"
          : undefined,
      truncationReason:
        !isSummaryOnly && diff.isTruncated
          ? "text diff truncated to fit per-file evidence budget"
          : undefined,
      unavailableReason:
        !isSummaryOnly && !hasTextualDiff
          ? "no textual diff available"
          : undefined,
    };
  }

  const withEvidence = {
    ...change,
    evidence,
  };

  return {
    ...withEvidence,
    fingerprint: await getChangeFingerprint(repoRoot, withEvidence),
  };
};

export const getChangeEvidenceTextLength = (change: GitChange): number =>
  (change.evidence.diff?.length ?? 0) + (change.evidence.content?.length ?? 0);

const assignIdsAndEvidence = async (
  git: SimpleGit,
  repoRoot: string,
  changes: GitChange[],
  options: Required<EvidenceOptions>,
): Promise<GitChange[]> => {
  const changesWithEvidence: GitChange[] = [];

  for (const [index, change] of changes.entries()) {
    const changeWithId = {
      ...change,
      id: `C${String(index + 1).padStart(3, "0")}`,
    };

    changesWithEvidence.push(
      await attachEvidence(git, repoRoot, changeWithId, options),
    );
  }

  return changesWithEvidence;
};

const getCounts = (changes: GitChange[]): Record<ChangeKind, number> => ({
  modified: changes.filter((change) => change.kind === "modified").length,
  added: changes.filter((change) => change.kind === "added").length,
  deleted: changes.filter((change) => change.kind === "deleted").length,
  renamed: changes.filter((change) => change.kind === "renamed").length,
  copied: changes.filter((change) => change.kind === "copied").length,
  untracked: changes.filter((change) => change.kind === "untracked").length,
});

const getChangeSetFingerprint = (changes: GitChange[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        changes.map((change) => ({
          identity: change.identity,
          fingerprint: change.fingerprint,
        })),
      ),
    )
    .digest("hex");

export const collectChangeSet = async (
  git: SimpleGit,
  selectedPaths: string[],
  evidenceOptions: EvidenceOptions = {},
): Promise<ChangeSet> => {
  const options: Required<EvidenceOptions> = {
    maxDiffChars: evidenceOptions.maxDiffChars ?? 12000,
    maxUntrackedContentBytes: evidenceOptions.maxUntrackedContentBytes ?? 12000,
  };

  const fullEntries = await runStatusPorcelain(git, []);
  const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
  const selectedEntries =
    selectedPaths.length > 0
      ? await runStatusPorcelain(git, selectedPaths)
      : fullEntries;
  const fullChanges = entriesToChanges(fullEntries);
  const selectedChanges = entriesToChanges(selectedEntries);
  const selectedIdentities = new Set<string>();
  const selectedFullChanges: GitChange[] = [];

  for (const selectedChange of selectedChanges) {
    const fullChange = findFullChangeForSelectedChange(
      selectedChange,
      fullChanges,
    );
    if (selectedIdentities.has(fullChange.identity)) continue;

    selectedIdentities.add(fullChange.identity);
    selectedFullChanges.push(fullChange);
  }

  const changes = await assignIdsAndEvidence(
    git,
    repoRoot,
    selectedFullChanges,
    options,
  );
  const selectedIdentitySet = new Set(changes.map((change) => change.identity));
  const stagedOutsideSelectedChanges = fullChanges.filter(
    (change) =>
      selectedPaths.length > 0 &&
      hasStagedChange(change) &&
      !selectedIdentitySet.has(change.identity),
  );

  return {
    selectedPaths,
    changes,
    allChanges: fullChanges,
    conflicts: fullEntries.filter((entry) => entry.type === "unmerged"),
    stagedOutsideSelectedChanges,
    fingerprint: getChangeSetFingerprint(changes),
    counts: getCounts(changes),
  };
};

type SerializeChangeSetOptions = {
  includeTextEvidence?: boolean;
};

type ChangeTitleOptions = {
  formatPath?: (path: string) => string;
};

const formatChangePath = (
  change: Pick<GitChange, "path" | "fromPath">,
  { formatPath = (path: string) => path }: ChangeTitleOptions = {},
) =>
  change.fromPath
    ? `${formatPath(change.fromPath)} -> ${formatPath(change.path)}`
    : formatPath(change.path);

const serializeEvidenceForPrompt = (
  evidence: ChangeEvidence,
  { includeTextEvidence = true }: SerializeChangeSetOptions = {},
) => ({
  summary: evidence.summary,
  stats: evidence.stats,
  isNoisy: evidence.isNoisy,
  isBinary: evidence.isBinary,
  isTruncated: evidence.isTruncated,
  isSummaryOnly: evidence.isSummaryOnly,
  isUnavailable: evidence.isUnavailable,
  summaryReason: evidence.summaryReason,
  truncationReason: evidence.truncationReason,
  unavailableReason: evidence.unavailableReason,
  ...(includeTextEvidence
    ? { diff: evidence.diff, content: evidence.content }
    : {}),
});

export const serializeChangeSetForPrompt = (
  changeSet: ChangeSet,
  options: SerializeChangeSetOptions = {},
) =>
  changeSet.changes.map((change) => ({
    id: change.id,
    kind: change.kind,
    path: change.path,
    fromPath: change.fromPath,
    indexState: change.indexState,
    worktreeState: change.worktreeState,
    stagePathspecs: change.stagePathspecs,
    commitPathspecs: change.commitPathspecs,
    evidence: serializeEvidenceForPrompt(change.evidence, options),
  }));

export const getChangeSetForChangeIds = (
  changeSet: ChangeSet,
  changeIds: readonly string[],
): ChangeSet => {
  const changesById = new Map(
    changeSet.changes.map((change) => [change.id, change]),
  );
  const changes = changeIds.flatMap((changeId) => {
    const change = changesById.get(changeId);
    return change ? [change] : [];
  });

  return {
    ...changeSet,
    changes,
    fingerprint: getChangeSetFingerprint(changes),
    counts: getCounts(changes),
  };
};

export const getChangeLabels = (
  changeSet: ChangeSet,
  changeIds: readonly string[],
  options: ChangeTitleOptions = {},
): string[] => {
  const changesById = new Map(
    changeSet.changes.map((change) => [change.id, change]),
  );

  return changeIds.map((changeId) => {
    const change = changesById.get(changeId);
    if (!change) return changeId;

    return `${change.id} ${change.kind}: ${formatChangePath(change, options)}`;
  });
};

export const getEvidenceStats = (changeSet: ChangeSet) => ({
  summaryOnlyCount: changeSet.changes.filter(
    (change) => change.evidence.isSummaryOnly,
  ).length,
  truncatedCount: changeSet.changes.filter(
    (change) => change.evidence.isTruncated,
  ).length,
  unavailableCount: changeSet.changes.filter(
    (change) => change.evidence.isUnavailable,
  ).length,
  noisyCount: changeSet.changes.filter((change) => change.evidence.isNoisy)
    .length,
  evidenceChars: changeSet.changes.reduce(
    (total, change) => total + getChangeEvidenceTextLength(change),
    0,
  ),
});

export const getPathspecsForChangeIds = (
  changeSet: ChangeSet,
  changeIds: readonly string[],
  key: "stagePathspecs" | "commitPathspecs",
): string[] => {
  const changesById = new Map(
    changeSet.changes.map((change) => [change.id, change]),
  );
  const pathspecs = changeIds.flatMap(
    (changeId) => changesById.get(changeId)?.[key] ?? [],
  );

  return Array.from(new Set(pathspecs));
};

export const validateCommitCoverage = (
  commits: readonly CommitChangeGroup[],
  expectedChangeIds: readonly string[],
): CommitCoverageIssue => {
  const expectedChangeIdSet = new Set(expectedChangeIds);
  const seenCounts = new Map<string, number>();

  for (const commit of commits) {
    for (const changeId of commit.changeIds) {
      seenCounts.set(changeId, (seenCounts.get(changeId) ?? 0) + 1);
    }
  }

  const missing = expectedChangeIds.filter(
    (changeId) => !seenCounts.has(changeId),
  );
  const duplicated = Array.from(seenCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([changeId]) => changeId);
  const unexpected = Array.from(seenCounts.keys()).filter(
    (changeId) => !expectedChangeIdSet.has(changeId),
  );

  return {
    ok:
      missing.length === 0 &&
      duplicated.length === 0 &&
      unexpected.length === 0,
    missing,
    duplicated,
    unexpected,
  };
};

export const formatCommitCoverageIssue = ({
  missing,
  duplicated,
  unexpected,
}: CommitCoverageIssue): string => {
  const lines: string[] = [];

  if (missing.length > 0) lines.push(`Missing: ${missing.join(", ")}`);
  if (duplicated.length > 0) lines.push(`Duplicated: ${duplicated.join(", ")}`);
  if (unexpected.length > 0) lines.push(`Unexpected: ${unexpected.join(", ")}`);

  return lines.length > 0 ? lines.join("\n") : "Coverage is valid.";
};

export const createCoverageRepairPrompt = (
  prompt: string,
  issue: CommitCoverageIssue,
): string => `${prompt}

---

## Correction Required

Your previous response had invalid change coverage:

${formatCommitCoverageIssue(issue)}

Regenerate the complete commit grouping. Every ID in "Selected Changes" must appear in exactly one output \`changeIds\` array, and no other IDs may appear.`;

export const getChangedChangeIds = (changeSet: ChangeSet): string[] =>
  changeSet.changes.map((change) => change.id);

export const getChangeSetDrift = (
  originalChangeSet: ChangeSet,
  currentChangeSet: ChangeSet,
  changeIds: readonly string[],
  options: ChangeTitleOptions = {},
): string[] => {
  const originalChangesById = new Map(
    originalChangeSet.changes.map((change) => [change.id, change]),
  );
  const currentChangesByIdentity = new Map(
    currentChangeSet.changes.map((change) => [change.identity, change]),
  );
  const drifted: string[] = [];

  for (const changeId of changeIds) {
    const originalChange = originalChangesById.get(changeId);
    if (!originalChange) {
      drifted.push(`${changeId} no longer exists in the original change set`);
      continue;
    }

    const currentChange = currentChangesByIdentity.get(originalChange.identity);
    if (!currentChange) {
      drifted.push(
        `${changeId} ${originalChange.kind}: ${formatChangePath(
          originalChange,
          options,
        )} is gone`,
      );
      continue;
    }

    if (currentChange.fingerprint !== originalChange.fingerprint) {
      drifted.push(
        `${changeId} ${originalChange.kind}: ${formatChangePath(
          originalChange,
          options,
        )} changed`,
      );
    }
  }

  return drifted;
};
