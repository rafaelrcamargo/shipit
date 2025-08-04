# shipit :shipit:

> Because writing `fix stuff` gets old real quick...

![Demo of shipit generating commit messages](shipit.gif)

Tired of staring at your messy diff wondering what the hell to call this commit? This bad boy analyzes your chaotic changes and gets AI to do the heavy lifting, writing actual commit messages that don't suck. It's smart enough to group your scattered changes into logical commits, follows conventional commit standards _(because we're not animals)_, and can even whip up GitHub PRs with descriptions that won't make your teammates cry. Say goodbye to `wip`, `asdf`, and `checkpoint` for now. Your Git history will finally look like you know what you're doing[^1].

[^1]: Self-criticism from the creator here, I made this tool because my own Git history was a disaster. :D

> [!IMPORTANT]
> This tool requires one of the following AI provider API keys to be set as an environment variable:
>
> - **Claude (Anthropic)**: `ANTHROPIC_API_KEY` - Get yours at <https://console.anthropic.com/>
> - **GPT (OpenAI)**: `OPENAI_API_KEY` - Get yours at <https://platform.openai.com/api-keys>
> - **Gemini (Google)**: `GOOGLE_GENERATIVE_AI_API_KEY` - Get yours at <https://aistudio.google.com/app/apikey>
>
> The tool will automatically detect and use the first available API key in the order above. The free tiers should be sufficient for running this tool.

## Setup

```bash
# Build it and copy to /usr/local/bin/shipit
bun run build && sudo bun run copy

# Set one of these API keys (tool will auto-detect which one to use):

# For Claude (Anthropic) - Recommended
export ANTHROPIC_API_KEY="sk-ant-..."

# For GPT (OpenAI)
export OPENAI_API_KEY="sk-..."

# For Gemini (Google) - Fallback option
export GOOGLE_GENERATIVE_AI_API_KEY="..."
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
shipit                    # Process all changed files
shipit index.ts utils.ts  # Process specific files

shipit --help             # Show help and all options

# Common use cases
shipit -fu                # The want-to-get-shit-done combo
shipit -y --pr            # The no-time-to-waste combo, get it in there
```

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
