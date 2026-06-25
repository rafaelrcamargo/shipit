import type { SimpleGit } from "simple-git";

import { getErrorMessage } from "./utils";

export interface PrTemplate {
  content: string;
  source: string;
}

const PR_TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
] as const;

async function fileExists(git: SimpleGit, path: string): Promise<boolean> {
  try {
    await git.show([`HEAD:${path}`]);
    return true;
  } catch {
    return false;
  }
}

async function readFile(git: SimpleGit, path: string): Promise<string> {
  try {
    const content = await git.show([`HEAD:${path}`]);
    return content.trim();
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${getErrorMessage(error)}`);
  }
}

async function listDirectory(git: SimpleGit, path: string): Promise<string[]> {
  try {
    const dirPath = path.endsWith("/") ? path : `${path}/`;
    const output = await git.raw(["ls-tree", "--name-only", "HEAD", dirPath]);
    return output
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .map((file) => {
        const parts = file.split("/");
        return parts[parts.length - 1] || "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function findPrTemplate(
  git: SimpleGit,
): Promise<PrTemplate | null> {
  for (const templatePath of PR_TEMPLATE_PATHS) {
    if (await fileExists(git, templatePath)) {
      try {
        const content = await readFile(git, templatePath);
        return {
          content,
          source: templatePath,
        };
      } catch (error) {
        console.warn(
          `Warning: Found template at ${templatePath} but couldn't read it: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  const templateDir = ".github/PULL_REQUEST_TEMPLATE";
  const templateFiles = await listDirectory(git, templateDir);

  if (templateFiles.length > 0) {
    const mdFiles = templateFiles.filter((file) => file.endsWith(".md"));
    const targetFile = mdFiles.length > 0 ? mdFiles[0] : templateFiles[0];
    const fullPath = `${templateDir}/${targetFile}`;

    try {
      const content = await readFile(git, fullPath);
      return {
        content,
        source: fullPath,
      };
    } catch (error) {
      console.warn(
        `Warning: Found template at ${fullPath} but couldn't read it: ${getErrorMessage(error)}`,
      );
    }
  }

  return null;
}
