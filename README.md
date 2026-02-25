# shipit :shipit:

> Because writing `fix stuff` gets old real quick...

![Demo of shipit generating commit messages](shipit.gif)

Tired of staring at your messy diff wondering what the hell to call this commit? This bad boy analyzes your chaotic changes and gets AI to do the heavy lifting, writing actual commit messages that don't suck. It's smart enough to group your scattered changes into logical commits, follows conventional commit standards _(because we're not animals)_, and can even whip up GitHub PRs with descriptions that won't make your teammates cry. Say goodbye to `wip`, `asdf`, and `checkpoint` for now. Your Git history will finally look like you know what you're doing[^1].

[^1]: Self-criticism from the creator here, I made this tool because my own Git history was a disaster. :D

> [!IMPORTANT]
> This tool requires one of the following AI provider API keys to be set as an environment variable:
>
> - **Gemini 3 Flash Preview (Google)**: `GOOGLE_GENERATIVE_AI_API_KEY` - Get yours at <https://aistudio.google.com/app/apikey>
> - **GPT-5.1 Codex Mini (OpenAI)**: `OPENAI_API_KEY` - Get yours at <https://platform.openai.com/api-keys>
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

# Optional: force provider/model selection instead of key-order fallback
export SHIPIT_PROVIDER="openai" # google | openai | anthropic | groq
export SHIPIT_MODEL="gpt-5.1-codex-mini"
```

### Provider and Model Overrides

`shipit` supports explicit provider/model selection:

- `SHIPIT_PROVIDER=google|openai|anthropic|groq`
- `SHIPIT_MODEL=<provider-compatible-model-id>`

Resolution order:

1. If `SHIPIT_PROVIDER` is set, `shipit` uses it directly.
2. If `SHIPIT_MODEL` is set, `SHIPIT_PROVIDER` is required.
3. If no override is set, `shipit` falls back to API key detection order:
   - `GOOGLE_GENERATIVE_AI_API_KEY`
   - `OPENAI_API_KEY`
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
export SHIPIT_MODEL="gpt-5.1-codex-mini"
```

#### bash (`~/.bashrc`)

```bash
export OPENAI_API_KEY="..."
export SHIPIT_PROVIDER="openai"
export SHIPIT_MODEL="gpt-5.1-codex-mini"
```

#### fish (`config.fish`)

```fish
set -Ux OPENAI_API_KEY "..."
set -Ux SHIPIT_PROVIDER "openai"
set -Ux SHIPIT_MODEL "gpt-5.1-codex-mini"
```

#### PowerShell (`$PROFILE`)

```powershell
$env:OPENAI_API_KEY="..."
$env:SHIPIT_PROVIDER="openai"
$env:SHIPIT_MODEL="gpt-5.1-codex-mini"
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

shipit --help             # Show help and all options
```

### Flags

| Flag | Long Form           | Description                                               |
| ---- | ------------------- | --------------------------------------------------------- |
| `-y` | `--yes`             | Automatically accept all commits (same as `--force`)      |
| `-f` | `--force`           | Automatically accept all commits (same as `--yes`)        |
| `-u` | `--unsafe`          | Skip token count verification                             |
| `-p` | `--push`            | Push the changes after processing all commits             |
|      | `--pr`              | Create a pull request (works with or without new commits) |
| `-a` | `--appendix <text>` | Add extra context to the commit generation prompt         |

### Common Examples

```bash
# The want-to-get-shit-done combo
shipit -fu                # Force commits + skip token verification

# The no-time-to-waste combo
shipit -y --pr            # Auto-accept commits + create PR

# Add context to help AI understand your changes
shipit -a "refactoring for performance"

# Full automation: commit, push, and create PR
shipit -y --push --pr
```

### PR Template Support

`shipit` automatically detects and follows your repository's PR templates when generating pull requests. The AI will structure the PR description according to your template's format, ensuring consistency with your team's guidelines.

When a template is found, you'll see: `Found PR template at {path} - following repository guidelines! 📝`

> [!NOTE]
> To generate pull requests with `--pr`, you'll need the [GitHub CLI](https://cli.github.com/) installed and authenticated. For private repositories, ensure you have the necessary permissions.

<details>
<summary>

### A Note on Other Tools

</summary>

`shipit` was built after months of using other AI-powered commit tools and finding they fell just short of the ideal workflow; so close, yet so far. While fantastic tools like `cz-git` and Cursor exist, `shipit` takes a different path to solve a few key annoyances.

- **[`cz-git`](https://github.com/Zhengqbbb/cz-git):** A fantastic, highly customizable tool for the entire git workflow. However, the AI integration feels more like an addon. Because the prompts are simple and lack the full context of your changes, you can end up with generic, high-level commit messages like `refactor: rewrote the whole thing` or `feat: introducing D the genius language succeeding C`. While technically correct, these messages can be more alarming than informative, creating noise in the git history. (All that said, it's pretty fast :))

- **Cursor (and other AI Editors):** In-editor AI commit tools are powerful, but they come with their own friction. You often need to craft your own prompts or guidelines on the fly, and it pulls you out of a terminal-centric workflow. Sometimes, you just want to fire off a commit from the command line without switching contexts.

The idea behind `shipit` is that with modern, large-context models, the AI is already smart enough to understand the "why" behind your changes just by reading the `diff`. It lets the model do the heavy lifting, saving you from playing prompt engineer and giving you back precise, context-aware commit messages.

</details>
