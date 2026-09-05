# pixagram-skill

A Claude Code / Codex skill that gives an AI agent the context it needs to interact with the [Pixagram](https://pixagram.com) blockchain — a Hive fork.

The skill covers:
- Mainnet (`api.pixagram.com`) and testnet (`pixagram.dev`) RPC endpoints
- Token renames vs Hive (PIXA, PXS, VESTS, `PIX` pubkey prefix)
- API field renames Jussi performs (`pxs_balance`, `dpf_interval_ledger`, …)
- Genesis / system accounts (`initminer`, `pixa.rex`, `pixa.team`, `pixa.omnibus`, …) and the VESTS-only restrictions on the allocation accounts
- Hivemind routing for `bridge.*` / `follow_api.*` / `tags_api.*`
- Curl examples for the most common queries

The skill is intentionally brief — it points at [Hive's developer docs](https://developers.hive.io/) for everything that didn't change.

---

## Install — Claude Code

Claude Code auto-loads skills from `~/.claude/skills/<name>/SKILL.md` (user-wide) or `.claude/skills/<name>/SKILL.md` (per-project).

### Option A — user-wide (recommended)

Available in every Claude Code session, every project:

```bash
git clone git@github.com:pixagram-blockchain/pixagram-skill.git ~/.claude/skills/pixagram
```

Then open a new conversation. The skill is now discoverable; Claude will invoke it whenever a task mentions Pixagram, PIXA/PXS/VESTS, the public endpoints, or any account/post/witness operation on this chain.

### Option B — per-project

Scoped to one project's repo:

```bash
cd /path/to/your/project
git clone git@github.com:pixagram-blockchain/pixagram-skill.git .claude/skills/pixagram
```

You may want to add `.claude/skills/pixagram` to your project's `.gitignore` (or commit it if everyone on the team should get it).

### Verify

In a new Claude Code session, ask: *"What's the public-key prefix on Pixagram?"* — Claude should invoke the `pixagram` skill before answering.

---

## Install — Codex CLI

Codex CLI (OpenAI) reads context from `AGENTS.md` files: `~/.codex/AGENTS.md` for global instructions, or `AGENTS.md` at the root of any project.

Since Codex doesn't have a separate "skills" loader, append (or symlink) the skill content into the appropriate `AGENTS.md`.

### Option A — user-wide

```bash
git clone git@github.com:pixagram-blockchain/pixagram-skill.git ~/.codex/pixagram-skill
mkdir -p ~/.codex
cat ~/.codex/pixagram-skill/SKILL.md >> ~/.codex/AGENTS.md
```

To stay current with upstream:

```bash
cd ~/.codex/pixagram-skill && git pull
# then re-append (or maintain a marker block in AGENTS.md and replace between markers)
```

### Option B — per-project

```bash
cd /path/to/your/project
git clone git@github.com:pixagram-blockchain/pixagram-skill.git .codex-skills/pixagram
cat .codex-skills/pixagram/SKILL.md >> AGENTS.md
```

Or, if you prefer a single source of truth without copy-pasting:

```bash
# Replace AGENTS.md (or append a section to it) with an include marker, and run a small
# pre-commit hook / script to regenerate AGENTS.md from .codex-skills/*/SKILL.md.
```

### Verify

Run `codex` and ask the same probe question — *"What's the public-key prefix on Pixagram?"* — Codex should answer `PIX` and reference the renamed token model.

---

## Updating

### Claude Code

```bash
cd ~/.claude/skills/pixagram     # or .claude/skills/pixagram for per-project
git pull
```

### Codex CLI

```bash
cd ~/.codex/pixagram-skill && git pull
# then regenerate / re-append into AGENTS.md
```

---

## Contributing

PRs welcome. Keep the skill **brief** — it should give the agent the deltas from Hive and the endpoints, not be a full reference. The principle: anything documented identically by Hive belongs in the Hive docs, not here.
