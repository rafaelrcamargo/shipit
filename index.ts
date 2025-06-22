import { simpleGit, type StatusResult } from "simple-git";
import gitDiffParser from "gitdiff-parser";

const git = simpleGit("../cmrg/");

const { files, ...status } = await git.status();
console.log(JSON.stringify(status, null, 2));

const diff = await git.diff();
const parsedDiff = gitDiffParser.parse(diff);
console.log(JSON.stringify(parsedDiff, null, 2));

const diffSummary = await git.diffSummary();
console.log(JSON.stringify(diffSummary, null, 2));

console.log(`
# Context

You'll receive context on a Git repository.
It will show the status of the repository, the diff summary, and the diff of the actual changes.
Your job is to categorize them, analyze the changes, split them into groups, and provide a summary of the changes.
So that they can be used to generate commits, messages and descriptions.

## You'll follow the conventional commits specification as follows:

\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

### Examples:

\`\`\`
# Commit message with description and breaking change footer
feat: allow provided config object to extend other configs

BREAKING CHANGE: \`extends\` key in config file is now used for extending other config files
\`\`\`

\`\`\`
# Commit message with ! to draw attention to breaking change
feat!: send an email to the customer when a product is shipped
\`\`\`

\`\`\`
# Commit message with scope and ! to draw attention to breaking change
feat(api)!: send an email to the customer when a product is shipped
\`\`\`

\`\`\`
# Commit message with both ! and BREAKING CHANGE footer
chore!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6.
\`\`\`

\`\`\`
# Commit message with no body
docs: correct spelling of CHANGELOG
\`\`\`

\`\`\`
# Commit message with scope
feat(lang): add Polish language
\`\`\`

---

# Repository status

\`\`\`
${JSON.stringify(status, null, 2)}
\`\`\`

# Diff summary

\`\`\`
${JSON.stringify(diffSummary, null, 2)}
\`\`\`

# Diff

\`\`\`
${JSON.stringify(diff, null, 2)}
\`\`\`

# Instructions

1. Analyze the diff summary and the diff of the actual changes.
2. Categorize the changes.
3. Split the changes into groups.
4. Provide a summary of the changes.
5. Generate a commit message, description and footer IF NEEDED, for each group.
6. Return the groups in this format:

\`\`\`
[
  {
    files: [<path>, <path>, <path>],
    title: <title>,
    description: <description>,
    type: <"fix" | "feat" | "build" | "chore" | "ci" | "docs" | "style" | "refactor" | "perf" | "test" | "other">,
  },
  ...
]
\`\`\`

# Result:
`);
