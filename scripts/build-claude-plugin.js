#!/usr/bin/env node
/**
 * build-claude-plugin.js — package the Claude Code provider output as a
 * Claude Code plugin.
 *
 * The installer (`npx codeadd install`) writes `.claude/` into a project, which
 * needs a terminal. A plugin reaches the places that have none: Claude Code on
 * the web, cloud sessions, and the desktop app, where plugins are enabled from
 * a marketplace or synced from the claude.ai account.
 *
 *   framwork/.claude/commands/<name>.md  →  dist/claude-plugin/skills/<name>/SKILL.md
 *   framwork/.claude/{skills,agents}     →  dist/claude-plugin/{skills,agents}
 *   claude-plugin/{hooks,README.md}      →  dist/claude-plugin/{hooks,README.md}
 *                                        +  dist/claude-plugin/.claude-plugin/plugin.json
 *
 * ⛔ THIS FILE OWNS NO PROMPT TRANSFORMATION. `scripts/build.js` compiles the
 *    provider files and the CLI applies the default features to them, exactly as
 *    `install` does (captureBaselines + applyEnabledFeatures on a staged copy).
 *    The only rewrites here are the ones a plugin needs and an install does not:
 *
 *    1. Commands ship as skills. A plugin command answers only to
 *       `/codeadd:add-new`; a plugin skill also answers to the bare `/add-new`
 *       when nothing else claims it, which keeps every "next, run /add-plan"
 *       the commands print true. The frontmatter gains the `name` a skill needs.
 *    2. Resource paths. An installed project reads `.claude/skills/X/SKILL.md`
 *       from its own tree; a plugin lives in the plugin cache, so the path
 *       becomes `${CLAUDE_PLUGIN_ROOT}/skills/X/SKILL.md`, which Claude Code
 *       substitutes in skill, command and agent content. Only paths whose
 *       target ships in the plugin are rewritten; the skill `/add-qa-setup` writes and the
 *       example paths in add--token-efficiency belong to the project.
 *    3. Agent names. Plugin agents are namespaced `codeadd:<name>`, so a
 *       dispatch of `@ux-agent` becomes `@codeadd:ux-agent`, and an agent's
 *       `skills:` preload names `codeadd:add--x`.
 *
 *    The runtime core (`.codeadd/scripts`, templates, sidecars) still belongs to
 *    the project: commands run `node .codeadd/scripts/status.cjs` from the
 *    project root. The plugin's SessionStart hook installs that core with
 *    `npx codeadd install --providers none` when it is missing.
 *
 * ⛔ FEATURES ARE FIXED AT THE DEFAULTS. `codeadd features enable X` edits the
 *    project's installed files; it cannot reach the plugin cache. A project that
 *    needs a non-default feature set installs the `claude` provider with the CLI
 *    instead of the plugin.
 *
 * Usage: node scripts/build.js && node scripts/build-claude-plugin.js [--out <dir>]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_NAME = 'codeadd';
const PROVIDER_DIR = path.join(ROOT, 'framwork', '.claude');
const CORE_DIR = path.join(ROOT, 'framwork', '.codeadd');
const PLUGIN_SRC = path.join(ROOT, 'claude-plugin');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'claude-plugin');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage — the provider files as `install` leaves them, default features applied
// ---------------------------------------------------------------------------

/**
 * Copy the compiled provider files and the core into a throwaway project and let
 * the CLI apply the default features to it, the same two calls `install` makes.
 * Returns the staged `.claude/` directory.
 */
async function stageProviderFiles(version) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'codeadd-plugin-'));
  fs.cpSync(PROVIDER_DIR, path.join(stage, '.claude'), { recursive: true });
  fs.cpSync(CORE_DIR, path.join(stage, '.codeadd'), { recursive: true });
  writeFile(
    path.join(stage, '.codeadd', 'manifest.json'),
    JSON.stringify({ version, providers: ['claude'], files: [], hashes: {}, scope: 'project' }, null, 2) + '\n',
  );

  const cli = (f) => pathToFileURL(path.join(ROOT, 'cli', 'src', f)).href;
  const { captureBaselines } = await import(cli('injection-core.js'));
  const { applyEnabledFeatures } = await import(cli('features.js'));
  const baselines = captureBaselines(stage);
  if (baselines.warnings.length) throw new Error(`baseline warnings: ${baselines.warnings.join('; ')}`);
  applyEnabledFeatures(stage);
  return { stage, claudeDir: path.join(stage, '.claude') };
}

// ---------------------------------------------------------------------------
// Rewrites — pure, exported for the tests
// ---------------------------------------------------------------------------

/**
 * `.claude/{skills,agents}/<name>…` → `${CLAUDE_PLUGIN_ROOT}/…` and
 * `.claude/commands/<name>.md` → `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`
 * when `<name>` ships in the plugin. A path preceded by `~`, `/`, `.` or a word
 * character belongs to something else (`~/.claude/settings.json`).
 */
function rewriteResourcePaths(content, shipped) {
  return content.replace(
    /(?<![\w~/.$-])\.claude\/(skills|commands|agents)\/([A-Za-z0-9_-]+)(\.md)?/g,
    (match, kind, name, ext = '') => {
      if (kind === 'commands') {
        if (ext !== '.md' || !shipped.commands.has(name)) return match;
        return `\${CLAUDE_PLUGIN_ROOT}/skills/${name}/SKILL.md`;
      }
      if (kind === 'skills' ? !shipped.skills.has(name) : !shipped.agents.has(name)) return match;
      return `\${CLAUDE_PLUGIN_ROOT}/${kind}/${name}${ext}`;
    },
  );
}

/** A command's frontmatter gains the `name` its skill form needs. */
function commandAsSkill(content, name) {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return `---\nname: ${name}\n---\n\n${content}`;
  if (/^name:/m.test(fm[1])) return content;
  return content.replace(fm[0], `---\nname: ${name}\n${fm[1]}\n---\n`);
}

/** `@ux-agent` → `@codeadd:ux-agent` for every agent the plugin ships. */
function rewriteAgentMentions(content, agentNames) {
  if (agentNames.size === 0) return content;
  const names = [...agentNames].sort((a, b) => b.length - a.length).map((n) => n.replace(/-/g, '\\-'));
  const re = new RegExp(`(?<![\\w:@/-])@(${names.join('|')})(?![\\w-])`, 'g');
  return content.replace(re, (_, name) => `@${PLUGIN_NAME}:${name}`);
}

/** An agent's `skills:` preload list names plugin skills by their namespaced id. */
function rewriteAgentSkills(content, skillNames) {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return content;
  const body = fm[1].replace(/^(skills:\n)((?:[ \t]+- .*\n?)+)/m, (_, head, items) =>
    head + items.replace(/^([ \t]+- )([A-Za-z0-9_-]+)\s*$/gm, (line, dash, name) =>
      skillNames.has(name) ? `${dash}${PLUGIN_NAME}:${name}` : line),
  );
  return content.replace(fm[0], `---\n${body}\n---\n`);
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function pluginManifest(version) {
  return {
    name: PLUGIN_NAME,
    displayName: 'Code Addiction (ADD)',
    version,
    description:
      'AI-powered development workflows: discovery, planning, subagent-driven build, review and done, as Claude Code commands, skills and agents.',
    author: { name: 'brabos-ai', url: 'https://github.com/brabos-ai' },
    homepage: 'https://code.brabos.ai',
    repository: 'https://github.com/brabos-ai/code-addiction',
    license: 'MIT',
    keywords: ['codeadd', 'code-addiction', 'workflow', 'planning', 'review', 'subagents'],
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function buildClaudePlugin({ out = DEFAULT_OUT } = {}) {
  if (!fs.existsSync(path.join(PROVIDER_DIR, 'commands'))) {
    throw new Error('framwork/.claude/ not found — run `node scripts/build.js` first');
  }
  const version = readJson(path.join(ROOT, 'cli', 'package.json')).version;
  const { stage, claudeDir } = await stageProviderFiles(version);

  try {
    fs.rmSync(out, { recursive: true, force: true });
    fs.cpSync(path.join(claudeDir, 'skills'), path.join(out, 'skills'), { recursive: true });
    fs.cpSync(path.join(claudeDir, 'agents'), path.join(out, 'agents'), { recursive: true });

    const shipped = {
      skills: new Set(fs.readdirSync(path.join(out, 'skills'))),
      commands: new Set(),
      agents: new Set(fs.readdirSync(path.join(out, 'agents')).map((f) => f.replace(/\.md$/, ''))),
    };
    for (const file of fs.readdirSync(path.join(claudeDir, 'commands'))) {
      const name = file.replace(/\.md$/, '');
      if (shipped.skills.has(name)) throw new Error(`command ${name} collides with a skill of the same name`);
      const raw = fs.readFileSync(path.join(claudeDir, 'commands', file), 'utf8');
      writeFile(path.join(out, 'skills', name, 'SKILL.md'), commandAsSkill(raw, name));
      shipped.commands.add(name);
    }

    let rewritten = 0;
    for (const file of walkFiles(out)) {
      if (!file.endsWith('.md')) continue;
      const raw = fs.readFileSync(file, 'utf8');
      let next = rewriteResourcePaths(raw, shipped);
      next = rewriteAgentMentions(next, shipped.agents);
      if (path.dirname(file) === path.join(out, 'agents')) next = rewriteAgentSkills(next, shipped.skills);
      if (next !== raw) {
        fs.writeFileSync(file, next, 'utf8');
        rewritten++;
      }
    }

    fs.cpSync(path.join(PLUGIN_SRC, 'hooks'), path.join(out, 'hooks'), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_SRC, 'README.md'), path.join(out, 'README.md'));
    fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(out, 'LICENSE'));
    writeFile(path.join(out, '.claude-plugin', 'plugin.json'), JSON.stringify(pluginManifest(version), null, 2) + '\n');

    return {
      out,
      version,
      commands: shipped.commands.size,
      skills: shipped.skills.size,
      agents: shipped.agents.size,
      rewritten,
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = {
  PLUGIN_NAME,
  buildClaudePlugin,
  rewriteResourcePaths,
  rewriteAgentMentions,
  rewriteAgentSkills,
  commandAsSkill,
  pluginManifest,
};

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = i > -1 ? path.resolve(process.argv[i + 1]) : DEFAULT_OUT;
  buildClaudePlugin({ out })
    .then((r) => {
      console.log(`Claude Code plugin ${PLUGIN_NAME}@${r.version} → ${path.relative(ROOT, r.out) || r.out}`);
      console.log(`  Commands : ${r.commands}`);
      console.log(`  Skills   : ${r.skills}`);
      console.log(`  Agents   : ${r.agents}`);
      console.log(`  Rewritten: ${r.rewritten} file(s)`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
