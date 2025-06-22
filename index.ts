import { simpleGit, type StatusResult } from "simple-git";
import gitDiffParser from "gitdiff-parser";

const git = simpleGit("../cmrg/");

const { files, ...status } = await git.status();

const diffSummary = await git.diffSummary();

const diff = await git.diff();
const parsedDiff = gitDiffParser.parse(diff);

console.log(`
# Git Repository Analysis Task

You are a Git commit analyzer.
Your task is to analyze repository changes and organize them into logical commit groups following conventional commit standards.
Act like a seasoned software engineer who has been working with Git for years.
Your messages should be concise, clear, and to the point.
You should never include buzzwords or phrases like "refactoring" or "code cleanup".
You should prefer to describe why the changes were made, not what was done.

## Input Data

This section contains some context about the repository.
The status gives you a bigger picture of the changes in the repository.
The diff summary gives you a list of the files that were changed.
The full diff gives you the actual changes to the files.

### Repository Status:

\`\`\`json
${JSON.stringify(status)}
\`\`\`

### Diff Summary:

\`\`\`json
${JSON.stringify(diffSummary)}
\`\`\`

### Full Diff:

\`\`\`
${JSON.stringify(parsedDiff)}
\`\`\`

## Task Requirements

1. Analyze all changes in the repository
2. Group related changes together logically
3. Categorize each group by type and purpose
4. Generate conventional commit messages for each group

## Conventional Commit Format

### Specification:

The key words “MUST”, “MUST NOT”, “REQUIRED”, “SHALL”, “SHALL NOT”, “SHOULD”, “SHOULD NOT”, “RECOMMENDED”, “MAY”, and “OPTIONAL” in this document are to be interpreted as described in RFC 2119.

1. Commits MUST be prefixed with a type, which consists of a noun, feat, fix, etc., followed by the OPTIONAL scope, OPTIONAL !, and REQUIRED terminal colon and space.
2. The type feat MUST be used when a commit adds a new feature to your application or library.
3. The type fix MUST be used when a commit represents a bug fix for your application.
4. A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., fix(parser):
5. A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes, e.g., fix: array parsing issue when multiple spaces were contained in string.
6. A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
7. A commit body is free-form and MAY consist of any number of newline separated paragraphs.
8. One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a :<space> or <space># separator, followed by a string value (this is inspired by the git trailer convention).
9. A footer's token MUST use - in place of whitespace characters, e.g., Acked-by (this helps differentiate the footer section from a multi-paragraph body). An exception is made for BREAKING CHANGE, which MAY also be used as a token.
10. A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.
11. Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.
12. If included as a footer, a breaking change MUST consist of the uppercase text BREAKING CHANGE, followed by a colon, space, and description, e.g., BREAKING CHANGE: environment variables now take precedence over config files.
13. If included in the type/scope prefix, breaking changes MUST be indicated by a ! immediately before the :. If ! is used, BREAKING CHANGE: MAY be omitted from the footer section, and the commit description SHALL be used to describe the breaking change.
14. Types other than feat and fix MAY be used in your commit messages, e.g., docs: update ref docs.
15. The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
16. BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE, when used as a token in a footer.

### Message Format:

\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

### Commit Types:

- \`fix\`: Bug fixes
- \`feat\`: New features
- \`build\`: Build system or dependency changes
- \`chore\`: Maintenance tasks
- \`ci\`: CI/CD configuration changes
- \`docs\`: Documentation changes
- \`style\`: Code style changes (formatting, etc.)
- \`refactor\`: Code refactoring without changing functionality
- \`perf\`: Performance improvements
- \`test\`: Adding or updating tests

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

## Expected Output Format

Return a JSON array of commit groups:

\`\`\`json
[
  {
    files: [<path>, <path>, <path>],
    type: <"fix" | "feat" | "build" | "chore" | "ci" | "docs" | "style" | "refactor" | "perf" | "test" | "other">,
    scope: <scope>,
    description: <description>,
    body: <body>,
    breaking: <boolean>,
    footers: [<footer>, <footer>, <footer>],
  },
  ...
]
\`\`\`

### Field Descriptions
- files: Array of file paths affected by this commit group (required)
- type: Conventional commit type (required)
- scope: Optional scope for the changes (optional)
- description: Brief description of changes (required)
- body: Optional multi-line body with bullet points or paragraphs (optional)
- breaking: Boolean indicating if this introduces breaking changes (required)
- footers: Array of footer strings (e.g., "BREAKING CHANGE: ...", "Closes #123") (optional)

## Analysis Guidelines

1. Group by Purpose: Combine files that serve the same logical purpose
2. Separate Concerns: Don't mix different types of changes (features vs fixes)
3. Consider Dependencies: Group interdependent changes together
4. Atomic Commits: Each group should represent a complete, working change
5. Clear Descriptions: Write descriptions that are clear and concise

## Output Instructions

- Return ONLY the JSON array, no additional text
- Ensure all required fields are present
- Use clear, concise language
- Follow conventional commit standards strictly
- Group changes logically, not just by file type

---

Begin Analysis:
`);
