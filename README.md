# shipit :shipit:

> Because writing `fix stuff` gets old real quick...

Tired of staring at your messy diff wondering what the hell to call this commit? This bad boy analyzes your chaotic changes and gets AI to do the heavy lifting—writing actual commit messages that don't suck. It's smart enough to group your scattered changes into logical commits, follows conventional commit standards _(because we're not animals)_, and can even whip up GitHub PRs with descriptions that won't make your teammates cry. Say goodbye to `wip`, `asdf`, and `checkpoint` for now. Your Git history will finally look like you know what you're doing[^1].

[^1]: Self-criticism from the creator here, I made this tool because my own Git history was a disaster. :D

> [!IMPORTANT]
> This tool depends on `GOOGLE_GENERATIVE_AI_API_KEY` being set. Obtain your API key at <https://aistudio.google.com/app/apikey>.

## Setup

```bash
# Build it and copy to /usr/local/bin/shipit
bun run build && sudo bun run copy

# Ensure your API key is set. You can get one at <https://aistudio.google.com/app/apikey>.
export GOOGLE_GENERATIVE_AI_API_KEY="..."
```

> [!TIP]
> Add an alias to your shell config file _(`.bashrc`, `.zshrc`)_ to better suit your workflow. I personally use:
>
> ```bash
> alias gca="shipit"
> ```

## Usage

```bash
shipit                    # Process all changed files
shipit index.ts utils.ts  # Process specific files

shipit --help             # Show help and every option

# Common combinations
shipit -fu                # The want to get shit done combo
shipit -y --pr            # The no time to waste combo, get it in there
```
