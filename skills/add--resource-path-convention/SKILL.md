---
name: add--resource-path-convention
description: Use when writing commands or skills that reference other commands, skills, or scripts — ensures paths resolve correctly across all providers after installation
---

# Resource Path Convention

Commands and skills in `framwork/.codeadd/` are the source of truth. After build, they are placed in provider-specific directories (`.claude/commands/`, `.agents/skills/`, `.gemini/commands/`, etc.). Hardcoded `.codeadd/` paths to commands or skills break because these directories do not exist in the installed project. Use build-time variables to reference resources.

## When to Use

- Writing a command that references another command (e.g., add-build naming add-review)
- Writing a command or skill that references a skill file
- Reviewing existing commands/skills for broken path references
- Creating new commands in the product registry

## When NOT to Use

- Referencing scripts (`.codeadd/scripts/*.cjs` is always correct — fixed path)
- Referencing project files outside the framework (`docs/`, `src/`, etc.)
- Writing code in `build.js` or `cli/` (these operate on the build/install pipeline, not agent runtime)

## Variables

Build-time variables are available. `build.js` replaces them with the correct provider path during build.

**A fragment's variables are resolved at a different moment, by the same rule.** A fragment under
`fragments/` or `plugins/*/fragments/` is never built: it ships as authored, and the CLI injects it into
the installed commands when a feature or plugin is enabled. The CLI resolves each variable for the
provider of the file it is injecting into, with the rule `build.js` uses —
`cli/tests/fragment-placeholders.test.js` holds the two equal. **Write a fragment exactly as you write a
command.** Until that resolution existed, every variable in a fragment landed raw in the installed file.

### `.claude/commands/NAME.md`

Resolves to the full path of a command file for the target provider.

```
${CLAUDE_PLUGIN_ROOT}/skills/add-plan/SKILL.md

# Claude → ${CLAUDE_PLUGIN_ROOT}/skills/add-plan/SKILL.md
# Gemini → .gemini/commands/add-plan.toml
```

### `.claude/skills/NAME/FILE`

Resolves to the full path of a skill file. Use `SKILL.md` for the main file, or any sub-file name.

```
${CLAUDE_PLUGIN_ROOT}/skills/add--backend-development/SKILL.md

# Claude → ${CLAUDE_PLUGIN_ROOT}/skills/add--backend-development/SKILL.md
# Gemini → .gemini/skills/add--backend-development/SKILL.md
```

## .codeadd/scripts/ — literal, no variable

Everything the directory ships is reached by the literal path: `.codeadd/scripts/`.

### Scripts (no variable needed)

Node entries are reached by the literal path — the entries stay the same for every provider and for every install:

```
node .codeadd/scripts/status.cjs
node .codeadd/scripts/done.cjs
node .codeadd/scripts/backlog-cli.cjs
node .codeadd/scripts/backlog-commit.cjs
```

The shipped backlog entries are Node CommonJS modules: `backlog-cli.cjs` (the four read modes —
`list`/`search` print a seven-field summary with `--full`/`--ids` opt-in projections, `get <id>`
answers the exact detail read, and `changes [--since <sha>]` lists what changed on the board branch), `backlog-id.cjs` (global id allocation), `backlog-board.cjs` (the one module that
resolves, locks and syncs the board clone every other backlog script reads and writes), `backlog-git.cjs` and
`backlog-commit.cjs` (publication and recovery), plus `backlog-core.cjs` and `backlog-storage.cjs` (the canonical
core). The board server imports the core, the board module and the git primitives through its generated runtime copy. Invoke the backlog entries with `node .codeadd/scripts/<entry>.cjs`.
Use the CLI for reads; it only reads. Use the publication entry for every write: it is the one
route, and it lands on the `board` branch.

### `.codeadd/X`

Resolves to the literal `.codeadd/X` path — same across all providers. Use for **runtime paths** that exist in the user's installed project (the installer preserves `.codeadd/`), but are NOT distributed by the build pipeline.

Typical cases: artefacts generated at runtime by commands like `/add-wiki` (which writes `wiki/`), the manifest file, or any artefact materialized in the user's project after install.

```
.codeadd/wiki/domains/backend.md  # → .codeadd/wiki/domains/backend.md
.codeadd/manifest.json            # → .codeadd/manifest.json
```

**When to use `{{addpath:}}` vs `{{skill:}}`:**

| | `.claude/skills/NAME/FILE` | `.codeadd/skills/NAME/FILE` |
|---|---|---|
| Skill exists in the framework's skill source directory | ✅ | ❌ |
| Skill is generated at runtime in user project | ❌ | ✅ |
| Resolves per-provider | ✅ | ❌ (always `.codeadd/`) |

## Examples

### Correct

```markdown
## STEP 1: Load Context
1. Read ${CLAUDE_PLUGIN_ROOT}/skills/add-plan/SKILL.md — PRIMARY reference
2. Run: node .codeadd/scripts/status.cjs
3. Read ${CLAUDE_PLUGIN_ROOT}/skills/add--backend-development/SKILL.md
4. For components, Grep ${CLAUDE_PLUGIN_ROOT}/skills/add--ux-design/shadcn-docs.md
```

### Incorrect

```markdown
## STEP 1: Load Context
Read .codeadd/commands/add-plan.md          ← BROKEN: doesn't exist after install
cat .codeadd/skills/backend-development/SKILL.md  ← BROKEN: wrong path
node .codeadd/scripts/status.cjs             ← CORRECT: scripts are at .codeadd/
```

## Validation Checklist

```
[ ] No raw references to .codeadd/commands/ (use .claude/commands/NAME.md)
[ ] No raw references to .codeadd/skills/ (use .claude/skills/NAME/FILE for source skills, .codeadd/skills/NAME/FILE for runtime-generated skills)
[ ] Script references use .codeadd/scripts/ (literal, no variable)
[ ] Runtime artefacts in installed project use .codeadd/X
[ ] Command names match provider-map.json commands keys
[ ] Skill names match provider-map.json skills keys (with add- prefix)
[ ] Skill sub-files exist in the source skill directory
```