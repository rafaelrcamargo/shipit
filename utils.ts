import chalk from "chalk";
import type { SimpleGit } from "simple-git";

export const categorizeChangesCount = (changesCount: number) => {
  if (changesCount < 10) return "Nice!";
  if (changesCount < 50) return chalk.bold("Damn, solid work!");
  if (changesCount < 100) return chalk.green("Holy... we cookin'!");
  return chalk.red("Yikes, you'd better buy your reviewers some coffee!");
};

export const categorizeTokenCount = (tokenCount: number) => {
  if (tokenCount < 5000) {
    return {
      emoji: "🟢",
      label: `looking fresh ${chalk.dim("(instant response)")}`,
    };
  } else if (tokenCount < 15000) {
    return {
      emoji: "🟡",
      label: `still vibing ${chalk.dim("(1-2 seconds)")}`,
    };
  } else if (tokenCount < 50000) {
    return {
      emoji: "🟠",
      label: `getting spicy ${chalk.dim("(3-5 seconds)")}`,
    };
  } else if (tokenCount < 100000) {
    return {
      emoji: "🔴",
      label: `woah there territory ${chalk.dim("(may hit rate limits)")}`,
      description: "This will take 10+ seconds and cost significantly more.",
      needsConfirmation: true,
    };
  } else {
    return {
      emoji: undefined,
      label: chalk.bold.red("an absolute unit 💀"),
      description: "This exceeds most API limits and will be very expensive.",
      needsConfirmation: true,
    };
  }
};

export const decapitalizeFirstLetter = (str: string) =>
  str.charAt(0).toLocaleLowerCase() + str.slice(1);

export const pluralize = (
  count: number,
  singular: string,
  plural?: string,
): string => {
  if (count === 1) return singular;
  return plural || `${singular}s`;
};

/**
 * Wraps text to a specified maximum width.
 * @param text The text to wrap.
 * @param maxWidth The maximum width of each line (default: 80).
 * @returns The wrapped text as a single string with newlines.
 */
export const wrapText = (text: string, maxWidth: number = 80): string => {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const spaceNeeded = currentLine.length > 0 ? 1 : 0;
    const wouldExceedWidth =
      currentLine.length + word.length + spaceNeeded > maxWidth;

    if (wouldExceedWidth) {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        lines.push(word);
      }
    } else {
      currentLine += (currentLine.length > 0 ? " " : "") + word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.join("\n");
};

/**
 * Safely gets an error message from an unknown type.
 * @param error The error object, which can be of any type.
 * @returns A string representing the error message.
 */
export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Retrieves the base branch of the repository, trying 'main' first, then 'master'.
 * @param git A simple-git instance.
 * @returns The name of the base branch.
 * @throws If no base branch is found.
 */
export const getBaseBranch = async (git: SimpleGit): Promise<string> => {
  for (const branch of ["main", "master"]) {
    try {
      await git.revparse(["--verify", `origin/${branch}`]);
      return branch;
    } catch {
      // Branch doesn't exist, so we try the next one
    }
  }

  throw new Error("No base branch found");
};

/**
 * Formats file lists in a compact, readable way
 * @param files Array of file names
 * @param maxDisplay Maximum number of files to show before truncating
 * @returns Formatted string with file count and optionally truncated list
 */
export const formatFileList = (
  files: string[],
  maxDisplay: number = 5,
): string => {
  if (files.length === 0) return "no files";
  if (files.length === 1) return files[0] || "";

  const count = `${files.length} ${pluralize(files.length, "file")}`;

  if (files.length <= maxDisplay) {
    return `${count}: ${files.join(", ")}`;
  }

  const displayed = files.slice(0, maxDisplay);
  const remaining = files.length - maxDisplay;
  return `${count}: ${displayed.join(", ")} (+${remaining} more)`;
};

/**
 * Determines if an operation is routine and should use reduced verbosity
 * @param operation The operation being performed
 * @param context Additional context about the operation
 * @returns Whether to use reduced verbosity
 */
export const isRoutineOperation = (
  operation: string,
  _context?: unknown,
): boolean => {
  const routineOps = [
    "push_existing_branch",
    "single_file_commit",
    "minor_changes",
    "up_to_date_check",
  ];

  return routineOps.includes(operation);
};

/**
 * Creates a summary of changes instead of detailed listings
 * @param changes Object containing various change counts
 * @returns Compact summary string
 */
export const summarizeChanges = (changes: {
  files?: number;
  insertions?: number;
  deletions?: number;
  commits?: number;
}): string => {
  const parts: string[] = [];

  if (changes.files) {
    parts.push(`${changes.files} ${pluralize(changes.files, "file")}`);
  }
  if (changes.commits) {
    parts.push(`${changes.commits} ${pluralize(changes.commits, "commit")}`);
  }
  if (changes.insertions || changes.deletions) {
    const changeStr = [
      changes.insertions ? chalk.green(`+${changes.insertions}`) : null,
      changes.deletions ? chalk.red(`-${changes.deletions}`) : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (changeStr) parts.push(`(${changeStr})`);
  }

  return parts.join(", ");
};
