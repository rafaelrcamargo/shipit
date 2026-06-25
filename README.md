# shipit :shipit:

> Because writing `fix stuff` gets old real quick...

![Demo of shipit generating commit messages](shipit.gif)

Staring at a messy diff and about to type `fix stuff` again? `shipit` looks at your current Git changes, groups related work into commits, writes Conventional Commit messages, and can draft a GitHub PR when you're ready. Review the plan, accept the commits you want, and keep your history cleaner than `wip`, `asdf`, and `checkpoint`.

[^1]: Self-criticism from the creator here. I made this because my own Git history had way too many `wip` commits.

> [!IMPORTANT]
> This tool requires one of the following AI provider API keys to be set as an environment variable:
>
> - **GPT-5.4 Mini (OpenAI)**: `OPENAI_API_KEY` - Get yours at <https://platform.openai.com/api-keys>
> - **Gemini 3.5 Flash (Google)**: `GOOGLE_GENERATIVE_AI_API_KEY` - Get yours at <https://aistudio.google.com/app/apikey>
> - **Claude Haiku 4.5 (Anthropic)**: `ANTHROPIC_API_KEY` - Get yours at <https://console.anthropic.com/>
> - **Kimi K2 0905 (Groq)**: `GROQ_API_KEY` - Get yours at <https://console.groq.com/keys>
>
> By default, the tool auto-detects the first available API key in the order above. You can override this using `SHIPIT_PROVIDER` and `SHIPIT_MODEL`.

## Setup

```bash
# Build it and copy to /usr/local/bin/shipit
bun run build && sudo bun run copy

# Set one of these API keys (the tool will automatically detect which one to use):
export GOOGLE_GENERATIVE_AI_API_KEY="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GROQ_API_KEY="..."

# Optional: enrich commit/PR prompts with Linear tickets referenced by --ticket
# or discovered from branches/commits, e.g. ENG-123
export LINEAR_API_KEY="..."

# Optional: disable read-only GitHub prompt context collection
export SHIPIT_DISABLE_GH=1

# Optional: force provider/model selection instead of key-order fallback
export SHIPIT_PROVIDER="openai" # google | openai | anthropic | groq
export SHIPIT_MODEL="gpt-5.4-mini"
```

### Provider and Model Overrides

`shipit` supports explicit provider/model selection:

- `SHIPIT_PROVIDER=google|openai|anthropic|groq`
- `SHIPIT_MODEL=<provider-compatible-model-id>`

Resolution order:

1. If `SHIPIT_PROVIDER` is set, `shipit` uses it directly.
2. If `SHIPIT_MODEL` is set, `SHIPIT_PROVIDER` is required.
3. If no override is set, `shipit` falls back to API key detection order:
   - `OPENAI_API_KEY`
   - `GOOGLE_GENERATIVE_AI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `GROQ_API_KEY`

Validation behavior:

- Invalid `SHIPIT_PROVIDER` values fail fast with supported options.
- `SHIPIT_MODEL` without `SHIPIT_PROVIDER` fails fast to avoid ambiguity.
- Missing API key for a forced provider fails fast with the exact required env var.
- Invalid/incompatible models are surfaced with actionable errors during generation.

### Global Setup Examples

Set these once in your shell profile so they apply to every terminal.

#### zsh (`~/.zshrc`)

```bash
export OPENAI_API_KEY="..."
export SHIPIT_PROVIDER="openai"
export SHIPIT_MODEL="gpt-5.4-mini"
```

#### bash (`~/.bashrc`)

```bash
export OPENAI_API_KEY="..."
export SHIPIT_PROVIDER="openai"
export SHIPIT_MODEL="gpt-5.4-mini"
```

#### fish (`config.fish`)

```fish
set -Ux OPENAI_API_KEY "..."
set -Ux SHIPIT_PROVIDER "openai"
set -Ux SHIPIT_MODEL "gpt-5.4-mini"
```

#### PowerShell (`$PROFILE`)

```powershell
$env:OPENAI_API_KEY="..."
$env:SHIPIT_PROVIDER="openai"
$env:SHIPIT_MODEL="gpt-5.4-mini"
```

Reload your shell after editing profile files:

```bash
source ~/.zshrc   # or ~/.bashrc
```

Quick verification:

```bash
echo "$SHIPIT_PROVIDER"
echo "$SHIPIT_MODEL"
shipit --help
shipit
```

### Context Sources

`shipit` builds bounded read-only context before asking the AI for commits or PR descriptions:

- Git context is always collected: branch/base, commit list, diff stats, changed files, and selected ChangeSet evidence.
- GitHub context is opportunistic through `gh` when the CLI is installed and authenticated. Set `SHIPIT_DISABLE_GH=1` to skip read-only GitHub context collection.
- Linear context is enabled only when `LINEAR_API_KEY` is configured. It looks for issue IDs like `ENG-123` from `--ticket`, the current branch, and commits, then includes compact ticket details in the prompt. See the [Linear SDK docs](https://linear.app/developers/sdk) for API key setup.

Linear and GitHub failures do not block local commits. They are treated as optional unavailable context. `SHIPIT_DISABLE_GH=1` only disables prompt context collection; creating a PR with `--pr` still uses `gh`.

Lockfiles, generated files, and binary files stay covered by change IDs, but their raw diffs are summary-only by default. Ordinary source changes are not dropped to fit one prompt; when the evidence is large, `shipit` plans commit groups first and then makes focused AI requests for each group. While this runs, the active spinner shows the current AI phase, streamed group progress, retries, chunking, and compact token/latency summaries without printing prompts or model output.

For the internal pipeline, AI request flow, and small/big/huge diff behavior, see [ARCHITECTURE.md](ARCHITECTURE.md).

> [!TIP]
> Add an alias to your shell config file _(`.bashrc`, `.zshrc`)_ to better suit your workflow. I personally use:
>
> ```bash
> alias gca="shipit"
> ```

### Pre-built Binaries

For convenience, pre-built binaries for `macOS` _(`arm64` & `x64`)_, `Linux`, and `Windows` are automatically generated for every push to `main` on GitHub. You can find them in the [Actions](https://github.com/rafaelrcamargo/shipit/actions) tab of the repository.

Each workflow run will produce a set of artifacts, one for each target platform. Simply download the binary for your system, make it executable, and you're good to go. This allows you to use `shipit` without needing to have `Bun` or any other development tools installed on your system.

## Usage

```bash
# Basic usage
shipit                    # Process all changed files
shipit index.ts utils.ts  # Process specific files
shipit .                  # Process changes under the current directory
shipit ./src              # Process changes under src

shipit --help             # Show help and all options
shipit status             # Show provider, key, and context status
```

### Flags

| Flag | Long Form                | Description                                                                 |
| ---- | ------------------------ | --------------------------------------------------------------------------- |
| `-y` | `--yes`                  | Automatically accept generated commit prompts                               |
|      | `--skip-token-check`     | Skip token count confirmation                                               |
| `-p` | `--push`                 | Push the changes after processing all commits                               |
|      | `--pr`, `--pull-request` | Create a pull request; without path args, works with or without new commits |
| `-t` | `--ticket <id>`          | Add a ticket ID, repeatable                                                 |
|      | `--context <text>`       | Add extra context to the commit and PR prompts                              |

### Common Examples

```bash
# Quick commit flow
shipit -y --skip-token-check # Auto-accept commits + skip token confirmation

# Commit and PR flow
shipit -y --pr            # Auto-accept commits + create PR
shipit --pr               # Create PR for an already-committed branch

# Add context and tickets to help AI understand your changes
shipit --context "refactoring for performance"
shipit --ticket ENG-123 --ticket API-456

# Full automation: commit, push, and create PR
shipit -y --push --pr
```

### Status

Use `shipit status` to inspect the local setup without making an AI request. It reports the resolved provider/model, configured API key env vars, provider overrides, Linear availability, GitHub CLI auth, `SHIPIT_DISABLE_GH`, and basic Git repository context. Secret values are never printed. If `LINEAR_API_KEY` is missing, `--ticket` IDs are still included in prompts, but Linear issue details are not fetched.

### PR Template Support

`shipit` automatically detects and follows your repository's PR templates when generating pull requests. The AI will structure the PR description according to your template's format, ensuring consistency with your team's guidelines.

When a template is found, you'll see: `Found PR template at {path} - following repository guidelines! 📝`

> [!NOTE]
> To generate pull requests with `--pr`, you'll need the [GitHub CLI](https://cli.github.com/) installed and authenticated. For private repositories, ensure you have the necessary permissions.
> When path args are provided, `shipit --pr <path>` only acts on that selected path and exits without creating a PR if that path has no changes.

<details>
<summary>

### A Note on Other Tools

</summary>

`shipit` was built after months of using other AI-powered commit tools and wanting something more terminal-native. Tools like `cz-git` and Cursor are useful, but `shipit` takes a different path for a few common annoyances.

- **[`cz-git`](https://github.com/Zhengqbbb/cz-git):** A solid, highly customizable tool for the Git workflow. Its AI integration is lighter than `shipit`'s context-first approach, so commit messages can end up too generic for larger diffs.

- **Cursor (and other AI editors):** In-editor AI commit tools are useful, but they can pull you out of a terminal flow. Sometimes you just want to make a clean commit without switching context.

The idea behind `shipit` is simple: collect the right Git context locally, ask the model for structured output, validate it, then let you approve the result without babysitting prompts.

</details>
