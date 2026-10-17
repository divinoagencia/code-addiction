# Code Addiction (ADD) for Claude Code

The Code Addiction commands, skills and agents as a Claude Code plugin. Use it
where `npx codeadd install` is out of reach: Claude Code on the web, cloud
sessions and the desktop app. It works in the terminal too.

## Install

```text
/plugin marketplace add brabos-ai/code-addiction
/plugin install codeadd@code-addiction
```

From a shell: `claude plugin marketplace add brabos-ai/code-addiction`, then
`claude plugin install codeadd@code-addiction`.

**Cloud sessions and the desktop app.** A cloud session loads the plugins
enabled on your claude.ai account. Add the marketplace and enable `codeadd`
there once, and every session picks it up.

## Use

Same commands as an installed project: `/add-help`, `/add-brainstorm`,
`/add-new`, `/add-plan`, `/add-build`, `/add-review`, `/add-done`, and the rest.
If another plugin claims the same name, use the namespaced form, for example
`/codeadd:add-new`. Agents are namespaced too (`codeadd:reviewer-agent`).

## The project core

The commands call scripts that live in the project, under `.codeadd/`. On the
first session in a git project without them, the plugin's SessionStart hook
installs that core with the CLI, pinned to the framework release the plugin was
built from:

```bash
npx codeadd install --providers none --version v<plugin version>
```

It installs the core only (no `.claude/` files, since the plugin carries them)
and adds the ADD block to `.gitignore`. An existing installation is never
touched; when its version differs from the plugin's, Claude mentions it once.
Set `CODEADD_PLUGIN_BOOTSTRAP=0` to turn the install off and do it yourself.

## Plugin or CLI install

The plugin ships the default feature set (`tdd-pipeline` on, the rest off).
`codeadd features enable <name>` changes the project's installed files and
cannot reach a plugin. For another feature set, or for plugins such as
GitNexus and Playwright, install the `claude` provider with the CLI instead,
and leave this plugin disabled in that project so the two do not overlap.

Source: [github.com/brabos-ai/code-addiction](https://github.com/brabos-ai/code-addiction) ·
Docs: [code.brabos.ai](https://code.brabos.ai)
