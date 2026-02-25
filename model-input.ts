import { readFile } from "node:fs/promises";

import { getErrorMessage } from "./utils";

export type UntrackedFileContext = {
  path: string;
  content: string;
  isBinary: boolean;
  isTruncated: boolean;
};

type CollectUntrackedFileContextsParams = {
  filePaths: string[];
  selectedPaths: string[];
  maxFiles?: number;
  maxCharsPerFile?: number;
};

const isSelectedPathMatch = (filePath: string, selectedPath: string): boolean =>
  filePath === selectedPath || filePath.startsWith(`${selectedPath}/`);

const isPathSelected = (filePath: string, selectedPaths: string[]): boolean => {
  if (selectedPaths.length === 0) return true;
  return selectedPaths.some((selectedPath) =>
    isSelectedPathMatch(filePath, selectedPath),
  );
};

export const collectUntrackedFileContexts = async ({
  filePaths,
  selectedPaths,
  maxFiles = 20,
  maxCharsPerFile = 12000,
}: CollectUntrackedFileContextsParams): Promise<UntrackedFileContext[]> => {
  const contexts: UntrackedFileContext[] = [];

  for (const filePath of filePaths) {
    if (!isPathSelected(filePath, selectedPaths)) continue;
    if (contexts.length >= maxFiles) break;

    try {
      const raw = await readFile(filePath, "utf8");

      if (raw.includes("\u0000")) {
        contexts.push({
          path: filePath,
          content: "[binary file omitted]",
          isBinary: true,
          isTruncated: false,
        });
        continue;
      }

      const isTruncated = raw.length > maxCharsPerFile;
      const content = isTruncated ? raw.slice(0, maxCharsPerFile) : raw;

      contexts.push({
        path: filePath,
        content,
        isBinary: false,
        isTruncated,
      });
    } catch (error) {
      contexts.push({
        path: filePath,
        content: `[unable to read file: ${getErrorMessage(error)}]`,
        isBinary: false,
        isTruncated: false,
      });
    }
  }

  return contexts;
};
