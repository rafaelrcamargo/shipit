# shipit :shipit:

Because writing `fix stuff` gets old real quick...

This AI tool analyzes your Git diff and writes sensible commit messages. It groups related changes into logical commits, follows conventional commit standards, and even creates GitHub pull requests with well-written descriptions. No more "WIP" or "fixed stuff" commits; just clean, meaningful Git history. Plus, it'll roast you along the way, because debugging is hard enough without boring tools.

> [!IMPORTANT]
> This tool depends on `GOOGLE_GENERATIVE_AI_API_KEY` beeing defined. Obtain your API key at <https://aistudio.google.com/app/apikey>.

## Setup

```bash
# Build and copy to `/usr/local/bin`
bun run build && sudo bun run copy

# Ensure your API key is set. You can get one at <https://aistudio.google.com/app/apikey>.
export GOOGLE_GENERATIVE_AI_API_KEY="..."
```

> [!TIP]
> Add an alias to your shell config file (`.bashrc`, `.zshrc`) to make it suit your workflow better. I personally use:
>
> ```bash
> alias gca="shipit"
> ```

## Usage

```bash
shipit                    # Send all dirty files to be groupped and commited
shipit index.ts utils.ts  # Commit specific files
shipit -h                 # Show help, flags, and options
shipit -fu                # Auto-accept everything & Skip token warnings
```
