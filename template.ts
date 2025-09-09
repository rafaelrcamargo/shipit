import type { SimpleGit } from "simple-git";
import { getErrorMessage } from "./utils";

export interface PrTemplate {
  content: string;
  source: string;
}

/**
 * Standard GitHub PR template locations in order of precedence
 */
const PR_TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
] as const;

/**
 * Checks if a file exists in the git repository
 */
async function fileExists(git: SimpleGit, path: string): Promise<boolean> {
  try {
    await git.show([`HEAD:${path}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a file from the git repository
 */
async function readFile(git: SimpleGit, path: string): Promise<string> {
  try {
    const content = await git.show([`HEAD:${path}`]);
    return content.trim();
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${getErrorMessage(error)}`);
  }
}

/**
 * Lists files in a directory from the git repository
 */
async function listDirectory(git: SimpleGit, path: string): Promise<string[]> {
  try {
    // Add trailing slash to ensure we list files within the directory
    const dirPath = path.endsWith("/") ? path : `${path}/`;
    const output = await git.raw(["ls-tree", "--name-only", "HEAD", dirPath]);
    return output
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .map((file) => {
        // Extract just the filename from the full path
        const parts = file.split("/");
        return parts[parts.length - 1] || "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Finds and reads the first available PR template in the repository
 */
export async function findPrTemplate(
  git: SimpleGit,
): Promise<PrTemplate | null> {
  // Check standard single template locations
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

  // Check for multiple templates in .github/PULL_REQUEST_TEMPLATE/ directory
  const templateDir = ".github/PULL_REQUEST_TEMPLATE";
  const templateFiles = await listDirectory(git, templateDir);

  if (templateFiles.length > 0) {
    // Find the first .md file or use the first file if none are .md
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

/**
 * Analyzes a PR template and extracts its structure for AI processing
 */
export function analyzePrTemplate(template: PrTemplate): {
  sections: Array<{ heading: string; description: string }>;
  hasCheckboxes: boolean;
  requirements: string[];
} {
  const content = template.content;
  const sections: Array<{ heading: string; description: string }> = [];
  const requirements: string[] = [];

  // Extract markdown sections (## or ### headings)
  const sectionMatches = content.match(/^#{2,3}\s+(.+)$/gm) || [];
  for (const match of sectionMatches) {
    const heading = match.replace(/^#{2,3}\s+/, "").trim();
    sections.push({ heading, description: "" });
  }

  // Check for checkboxes
  const hasCheckboxes = /- \[ \]/.test(content);

  // Extract common requirement patterns
  const requirementPatterns = [
    /- \[ \]\s*(.+)/g, // Checkbox items
    /\*\*Required\*\*:?\s*(.+)/gi,
    /\*\*Must\*\*:?\s*(.+)/gi,
    /\*\*Please\*\*:?\s*(.+)/gi,
  ];

  for (const pattern of requirementPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) {
        requirements.push(match[1].trim());
      }
    }
  }

  return {
    sections,
    hasCheckboxes,
    requirements,
  };
}
