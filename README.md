# git-thing

To compile the project, run:

```bash
bun run build
```

> [!IMPORTANT]
>
> Make sure you have your `GOOGLE_GENERATIVE_AI_API_KEY` environment variable set before running the tool. More info at: <https://aistudio.google.com/app/apikey>

Then move it to `/usr/local/bin`:

```bash
sudo mv build/git-thing /usr/local/bin/git-thing
```

> [!TIP]
>
> You can add a alias to your shell configuration file (e.g., `.bashrc`, `.zshrc`) to make it easier to run the tool:
>
> ```bash
>   alias gt="git-thing"
> ```
