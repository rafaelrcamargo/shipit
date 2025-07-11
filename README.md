# git-thing

ai writes your git commits because "fix stuff" gets old fast.

this tool looks at your changes and uses google's gemini to generate proper commit messages. it can split your mess into logical commits and even create pull requests.

## what it does

- generates conventional commits that make sense
- analyzes your diffs to suggest logical groupings
- warns about expensive api calls for huge diffs
- creates github prs with ai-generated descriptions
- lets you review everything before committing
- works with specific files or everything staged

## requirements

you need bun, git, github cli, and a google ai api key.

get your api key at <https://aistudio.google.com/app/apikey>

## installation

build it:

```bash
bun run build
```

install it:

```bash
sudo mv build/git-thing /usr/local/bin/git-thing
```

set your api key:

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
```

add an alias if you want:

```bash
alias gt="git-thing"
```

## usage

basic usage:

```bash
git-thing                    # commit all staged changes
git-thing src/index.ts       # commit specific files
git-thing --force            # auto-accept everything
git-thing --unsafe           # skip token warnings
git-thing --silent           # minimal output
```

normal workflow:

```bash
git add .
git-thing
# review and approve commits
```

## options

- `--force` or `-f`: auto-accept all commits
- `--unsafe` or `-u`: skip token count warnings
- `--silent` or `-s`: minimal output only

## how it works

1. checks if you're in a git repo
2. analyzes what changed
3. sends diffs to google gemini
4. generates conventional commit messages
5. lets you review each one
6. optionally creates github prs

## troubleshooting

not a git repo? run `git init` first.

no changes? run `git add .` first.

api key missing? set `GOOGLE_GENERATIVE_AI_API_KEY`.

github cli missing? install it with `brew install gh`.

huge diffs cost money. use `--unsafe` to skip warnings or make smaller commits.
