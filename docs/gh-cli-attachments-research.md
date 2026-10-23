# GitHub CLI media attachments research

Research date: 2026-08-21

## Bottom line

GitHub has a working first-party preview of a repeatable `--attach` flag for local images and videos. It is implemented on six issue/PR commands, but it is **not in the current stable GitHub CLI release**. The current stable release is [2.98.0](https://github.com/cli/cli/releases/tag/v2.98.0), whose generated [`gh pr create` manual](https://cli.github.com/manual/gh_pr_create) has no `--attach`; the eight-PR implementation stack is still open and unmerged ([stack map](https://github.com/cli/cli/issues/14186), [top PR](https://github.com/cli/cli/pull/14184)).

As of this research, the only published preview is `gh 2.99.0-attach-preview` from the successful [Actions run 32151792777](https://github.com/cli/cli/actions/runs/32151792777), built on 2026-08-18 from commit `cf7aa91126cf100979496e259b2054e90f391d9f`. The maintainer's [preview announcement](https://github.com/cli/cli/issues/13256#issuecomment-5330474190) says the artifacts expire on 2026-08-25 and that the team plans a release by the end of August. That is a plan, not a compatibility guarantee. The public roadmap entry is still open ([roadmap #1324](https://github.com/github/roadmap/issues/1324)).

This should therefore be introduced to agents as a **capability they must detect**, not a version they may assume.

## Getting the preview

The preview is a one-off Actions artifact, not a normal release or persistent preview channel:

```bash
gh run download 32151792777 --repo cli/cli --name macos
```

Use `linux` or `windows` instead of `macos` for those platforms, then choose and extract the appropriate package/archive inside the artifact. For example, the verified macOS arm64 archive contains:

```text
gh_2.99.0-attach-preview_macOS_arm64/bin/gh
```

Running it reports:

```text
gh version 2.99.0-attach-preview (2026-08-18)
```

The announcement also points to [PR #14184](https://github.com/cli/cli/pull/14184) as the tip of the source stack. Building that branch follows the repository's [source-install instructions](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/docs/install_source.md), but the branch and CLI contract can still change before merge.

## Supported command surfaces

The preview exposes `--attach` on exactly these commands ([announcement](https://github.com/cli/cli/issues/13256#issuecomment-5330474190), [stack map](https://github.com/cli/cli/issues/14186)):

- `gh issue create`
- `gh issue edit`
- `gh issue comment`
- `gh pr create`
- `gh pr edit`
- `gh pr comment`

There is no standalone upload command and no structured `url`/`markdown` output. General files such as PDFs, logs, ZIPs, and documents are not supported; a maintainer explicitly asked that broader file attachments be tracked separately in [issue #14194](https://github.com/cli/cli/issues/14194).

## Command and Markdown syntax

`--attach` is repeatable. A path may optionally be followed by `#` and image alt text:

```bash
gh pr comment 123 \
  --body "The narrow layout wraps incorrectly:" \
  --attach './artifacts/narrow.png#Narrow layout with wrapped labels'
```

With no matching reference in the body, each image is appended as its own Markdown image paragraph, in flag order. A video is appended as a bare asset URL paragraph so GitHub renders a player. `--attach file` by itself is sufficient body input for a comment. These behaviors are defined in the [command help](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/pkg/cmd/pr/comment/comment.go#L30-L51), [comment input handling](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/pkg/cmd/pr/shared/commentable.go#L88-L130), and [append implementation](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/attach.go#L54-L84).

For precise placement, author ordinary Markdown with local paths, then pass the same files to `--attach`:

```markdown
## Visual verification

Wide layout:

![Wide layout](./artifacts/wide.png)

Narrow layout:

![Narrow layout](./artifacts/narrow.png)
```

```bash
gh pr create \
  --title "Fix responsive picker layout" \
  --body-file pr.md \
  --attach ./artifacts/wide.png \
  --attach ./artifacts/narrow.png
```

The CLI uploads each file and replaces its local destination with the returned `github.com/user-attachments/...` URL. A body reference keeps the alt text authored in the body; `#alt text` is used when the CLI must append an image. The exact behavior is part of the preview's [`gh pr create` help](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/pkg/cmd/pr/create/create.go#L244-L265).

The rewriter handles inline links/images and reference-style links. It leaves paths in code spans/fences untouched. A video image embed becomes a bare URL only when it is alone in a paragraph; inline video embeds degrade to links. Reference-style image syntax targeting a video is rejected before upload because it would render as a broken image ([rewriter rules](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/references.go#L65-L197)).

Implementation inference: flag paths and Markdown destinations are both converted to absolute paths from the process working directory. A path is **not** resolved relative to the `--body-file` location, so agents should run from a known directory and author both paths relative to that directory ([path matching](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/references.go#L316-L354)).

## File, host, auth, and permission constraints

The preview accepts these extensions case-insensitively:

- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`
- Videos: `.mp4`, `.mov`, `.webm`

Local validation requires an existing, non-empty regular file. Directories, named pipes/devices, standard input (`--attach -`), unsupported extensions, and duplicate references to the same underlying file are rejected. Each image may be at most 10 MiB; each video may be at most 100 MiB, although the server can enforce a lower plan-dependent video limit. File type is inferred from the extension, so mismatched contents can still fail server validation ([asset validation](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/userasset.go#L12-L46), [file and size validation](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/userasset.go#L132-L196)).

`#alt text` is valid only for images. Without it, appended images derive alt text from the filename. Videos reject alt text and render as players/bare URLs ([image/video rendering](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/userasset.go#L77-L130)). Quote the combined path and alt text when it contains spaces or shell metacharacters.

Availability and authorization are narrower than ordinary PR creation:

- The [preview announcement](https://github.com/cli/cli/issues/13256#issuecomment-5330474190) says the feature is available to users on all GitHub plans.
- Supported hosts: GitHub.com and GitHub Enterprise Cloud with data residency (`*.ghe.com`). GitHub Enterprise Server is rejected.
- Accepted credentials: GitHub OAuth tokens, classic PATs, and fine-grained PATs.
- Rejected credentials include GitHub App user/server tokens and unknown token types. In particular, a normal Actions installation token with the `ghs_` prefix is rejected by this preview.
- The authenticated viewer must have `WRITE`, `MAINTAIN`, or `ADMIN` repository permission. `READ` and `TRIAGE` are insufficient.

These checks are explicit allowlists in the [uploader](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/client.go#L33-L105); token kinds are identified by prefix in the [auth config](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/config/config.go#L235-L257).

Flag conflicts and scope limits:

- `--attach` cannot be combined with `--web`, comment `--delete-last`, or PR-create `--dry-run` ([flag validation](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/flags.go#L109-L125)).
- `gh issue edit` refuses `--attach` when editing more than one issue ([issue-edit guard](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/pkg/cmd/issue/edit/edit.go#L229-L235)).
- The same underlying file may be uploaded once and referenced multiple times in one body, but it cannot be repeated as two `--attach` arguments ([repeatable flag validation](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/flags.go#L19-L69)).

## Failure semantics agents must understand

Uploads are irreversible through this feature: there is no compensating delete endpoint. Files upload sequentially in flag order and the implementation stops at the first failed upload. It does not retry ambiguous failures, because retrying an upload the server accepted could orphan another asset ([upload loop and irreversibility](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/attach.go#L9-L51), [single request path](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/client.go#L117-L168)).

If the first upload fails, the body is not written. If earlier files succeeded and a later file fails, the command still writes or creates the issue/PR/comment with the successfully uploaded assets, then returns an error/non-zero status. If the subsequent issue/PR/comment write fails, already uploaded assets remain and may be orphaned. Agents must therefore inspect both the exit status and the created/edited resource instead of treating a non-zero exit as proof that nothing changed. HTTP 404 is translated to a write-permission error; 413, 422 validation, rate-limit, server, transport, and malformed-response failures retain contextual errors ([error mapping](https://github.com/cli/cli/blob/ccd55e662d8a52cfd31cf7460079ef3c8ce4da05/internal/attachments/client.go#L171-L205)).

## Recommended agent contract

1. **Probe the exact command, not the version.** Before generating body Markdown with local references, run the same binary and surface that will perform the mutation, for example `gh pr create --help`, and confirm its output lists `--attach`. This read-only probe works on stable installations and remains valid if the flag ships in a version other than `2.99.0`.
2. **Do not emit unresolved local paths.** If the probe fails or `--attach` is absent, omit local image references from the GitHub body and report that the installed `gh` cannot upload them. Do not fall back to browser cookies, raw private-repository URLs, or undocumented upload calls.
3. **Validate before mutation.** Ensure every intended file exists, is non-empty, has a supported extension and size, and is unique. Use normal image Markdown plus the matching repeated `--attach` flags when placement matters.
4. **Prefer accessible authored placement.** Put each screenshot beside the claim it proves and author useful alt text in the Markdown body. Use `#alt text` only for attachments that are intentionally appended.
5. **Treat the operation as possibly partially successful.** On non-zero exit, retrieve the PR/issue/comment and reconcile what was written before retrying. Do not blindly rerun uploads.
6. **Keep the preview optional.** Stable `gh` remains a supported path; attachment-aware prompts should activate only after capability detection. Recheck the official release/manual and remove preview-specific version language once the stack merges.

For application code, perform the same probe by spawning `gh` with the argument vector `['pr', 'create', '--help']` (or the actual target surface) and checking successful output for the `--attach` option. Avoid parsing `gh --version` as the feature gate.

## Verification performed

- Queried the linked issue comment, release, roadmap, workflow run/artifacts, stack issue, and eight implementation PRs through GitHub's API on 2026-08-21.
- Downloaded the official macOS artifact, ran its `gh --version`, and confirmed `--attach` appears in the help for all six listed commands.
- Inspected the preview implementation and tests at the current stack tip, including validation, Markdown rewriting, upload behavior, and command wiring.
- Confirmed the stable `v2.98.0` source and current generated manual do not expose `--attach`.
- Did not perform a live upload or mutate any GitHub issue or pull request.
