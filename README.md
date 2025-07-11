# git-thing

ai writes your git commits because "fix stuff" gets old fast.

this tool looks at your changes and uses google's gemini to generate proper commit messages. it can split your mess into logical commits and even create pull requests.

## features

- **smart commit generation**: creates conventional commits that actually make sense
- **diff analysis**: groups related changes into logical commits
- **cost awareness**: warns about expensive api calls for massive diffs
- **github integration**: auto-creates prs with ai-generated descriptions
- **interactive workflow**: review and approve each commit before it ships
- **flexible targeting**: works with specific files or everything staged

## requirements

you need these installed:

- **bun** - runtime and package manager
- **git** - obviously
- **github cli** - for pr creation
- **google ai api key** - powers the magic

> [!IMPORTANT]
> get your api key at <https://aistudio.google.com/app/apikey> before running anything

## installation

**1. build the project:**

```bash
bun run build
```

**2. install globally:**

```bash
sudo mv build/git-thing /usr/local/bin/git-thing
```

**3. set your api key:**

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
```

> [!TIP]
> add this to your shell config (`.bashrc`, `.zshrc`) to make it permanent:
>
> ```bash
> alias gt="git-thing"
> ```

## usage

### basic commands

```bash
git-thing                    # commit all staged changes
git-thing src/index.ts       # commit specific files
git-thing --force            # auto-accept everything
git-thing --unsafe           # skip token warnings
git-thing --silent           # minimal output
```

### typical workflow

```bash
git add .
git-thing
# review each suggested commit
# approve the ones you like
```

### command options

| option     | short | what it does                             |
| ---------- | ----- | ---------------------------------------- |
| `--force`  | `-f`  | auto-accept all commits without asking   |
| `--unsafe` | `-u`  | skip token count warnings for huge diffs |
| `--silent` | `-s`  | minimal output, errors only              |

## how it works

1. **repo check**: makes sure you're in a git repo
2. **change detection**: finds what files changed
3. **diff analysis**: examines the actual code changes
4. **ai processing**: sends everything to google gemini
5. **commit generation**: creates proper conventional commits
6. **interactive review**: lets you approve each one
7. **pr creation**: optionally makes github prs

## troubleshooting

### common problems

**"not a git repo" error:**

```bash
git init  # initialize git first
```

**"no changes" error:**

```bash
git add .  # stage your changes first
```

**"api key not found" error:**

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
```

**github cli missing:**

```bash
brew install gh        # macos
sudo apt install gh    # ubuntu/debian
```

> [!WARNING]
> large diffs cost real money. the tool warns you about expensive calls, but you can bypass with `--unsafe` if you're feeling lucky.

### token costs

- small changes (< 1000 tokens): cheap
- medium changes (1000-5000 tokens): reasonable
- large changes (5000-10000 tokens): getting expensive
- huge changes (> 10000 tokens): your wallet will cry

use `--unsafe` to skip warnings or break big changes into smaller commits.
