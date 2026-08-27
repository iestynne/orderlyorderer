# SETUP.md

One-time setup. Assumes the bootstrap zip is unpacked to `orderlyorderer/`.

## 1. Layout

```
orderlyorderer/          <- launch Claude Code HERE, not in git/
  CLAUDE.md              pointer to git/CLAUDE.md (untracked)
  git/                   the repository. This is what reaches GitHub.
  local/game/v0.7-455/   unzip the game archive here
  local/scratch/
```

Git's root is `git/`. Git cannot see above its own root, so `local/` is
unreachable by it — a structural guarantee, not a rule that can be edited or
bypassed with `--no-verify`.

## 2. Unpack the game archive

Into `local/game/v0.7-455/`. The music files can be dropped; they are ~97% of
the bytes and nothing reads them. Keep `res/maps`, `res/sprite`, `res/font` and
the Lua source.

## 3. Initialise the repository

```bash
cd orderlyorderer/git
git init -b main
```

Verify the boundary holds **before committing anything**:

```bash
git status                    # nothing from ../local should appear — it cannot
git ls-files --others --exclude-standard | head   # review untracked files
```

Then:

```bash
git add .
git status                    # read this list properly
git commit -m "Bootstrap: reverse-engineering docs, savegame codec, fixtures"
```

## 4. Push to GitHub

Private for now — it will go public when there is an app worth showing.

With the GitHub CLI, which handles auth and creation together:

```bash
gh auth login
gh repo create orderlyorderer --private --source=. --push
```

Or create an empty private repo on the website (no README, no .gitignore, no
licence), then:

```bash
git remote add origin git@github.com:YOURNAME/orderlyorderer.git
git push -u origin main
```

SSH needs a key on your account; HTTPS needs a personal access token in place of
a password. `gh auth login` configures whichever you choose.

## 5. Optional guard

`.git/hooks/pre-commit`, then `chmod +x`:

```sh
#!/bin/sh
if git diff --cached --name-only | grep -qE '^game/|\.love$|\.png$'; then
  echo "BLOCKED: possible game asset staged. See docs/DECISIONS.md D14b."
  exit 1
fi
```

Two caveats: hooks live in `.git/` so they do not travel with the repository,
and `git commit --no-verify` bypasses them. This guards against accident, which
is the realistic risk — an agent running `git add -A` at the wrong moment.

## 6. Add a licence for your own code

Without a `LICENSE` file the default is all-rights-reserved, which is probably
not what you want for a community tool. MIT is the usual choice. Make sure the
README states that the licence covers Orderlyorderer's own code and **not**
bundled Towers of Scale assets.

## 7. Everyday git

```bash
git add -A && git commit -m "message" && git push
git log --oneline        # history
git diff                 # uncommitted changes
git restore <file>       # discard changes to a file
```
