/**
 * build-claude-plugin.test.js — the Claude Code plugin packaging.
 *
 * `scripts/build-claude-plugin.js` packages the compiled `framwork/.claude/`
 * (default features applied) as a plugin. What it owns, and what is asserted
 * here, is only what a plugin needs and an install does not: commands shipped
 * as skills, resource paths under `${CLAUDE_PLUGIN_ROOT}`, namespaced agent
 * names, the manifest and the SessionStart hook. The prompt content itself is
 * `build.test.js`'s.
 *
 * Requires `node scripts/build.js` to have run, like the other build suites.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const {
  PLUGIN_NAME,
  buildClaudePlugin,
  rewriteResourcePaths,
  rewriteAgentMentions,
  rewriteAgentSkills,
  commandAsSkill,
} = require(path.join(ROOT, 'scripts', 'build-claude-plugin.js'));

const shipped = {
  skills: new Set(['add--tdd', 'add-plan']),
  commands: new Set(['add-plan']),
  agents: new Set(['ux-agent', 'ux-flow-agent']),
};

describe('L1 rewrites', () => {
  it('points shipped skills, commands and agents at the plugin root', () => {
    const src = 'Load `.claude/skills/add--tdd/SKILL.md`, follow .claude/commands/add-plan.md, read .claude/agents/ux-agent.md';
    expect(rewriteResourcePaths(src, shipped)).toBe(
      'Load `${CLAUDE_PLUGIN_ROOT}/skills/add--tdd/SKILL.md`, follow ${CLAUDE_PLUGIN_ROOT}/skills/add-plan/SKILL.md, read ${CLAUDE_PLUGIN_ROOT}/agents/ux-agent.md',
    );
  });

  it('leaves project paths and paths the plugin does not ship alone', () => {
    const src = 'See .claude/settings.local.json, ~/.claude/settings.json, .claude/skills/qa-project/SKILL.md and .claude/commands/feature.md';
    expect(rewriteResourcePaths(src, shipped)).toBe(src);
  });

  it('namespaces agent mentions, longest name first, once', () => {
    const src = 'Dispatch @ux-flow-agent then @ux-agent; @codeadd:ux-agent stays; email@ux-agent stays';
    expect(rewriteAgentMentions(src, shipped.agents)).toBe(
      `Dispatch @${PLUGIN_NAME}:ux-flow-agent then @${PLUGIN_NAME}:ux-agent; @codeadd:ux-agent stays; email@ux-agent stays`,
    );
  });

  it('namespaces only shipped skills in an agent skills preload', () => {
    const src = '---\nname: x\nskills:\n  - add--tdd\n  - other\nmodel: sonnet\n---\nbody - add--tdd\n';
    expect(rewriteAgentSkills(src, shipped.skills)).toBe(
      `---\nname: x\nskills:\n  - ${PLUGIN_NAME}:add--tdd\n  - other\nmodel: sonnet\n---\nbody - add--tdd\n`,
    );
  });

  it('gives a command the name its skill form needs', () => {
    expect(commandAsSkill('---\ndescription: d\n---\n\n# T\n', 'add-new')).toBe('---\nname: add-new\ndescription: d\n---\n\n# T\n');
    expect(commandAsSkill('---\nname: keep\n---\n', 'add-new')).toBe('---\nname: keep\n---\n');
  });
});

describe('L2 build', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-plugin-'));
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));
  let result;
  const built = async () => (result ??= await buildClaudePlugin({ out }));

  it('requires the provider build', () => {
    expect(fs.existsSync(path.join(ROOT, 'framwork', '.claude', 'commands')), 'run `node scripts/build.js` first').toBe(true);
  });

  it('writes a manifest at the CLI version', async () => {
    const r = await built();
    const manifest = JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin', 'plugin.json'), 'utf8'));
    const cli = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli', 'package.json'), 'utf8'));
    expect(manifest.name).toBe(PLUGIN_NAME);
    expect(manifest.version).toBe(cli.version);
    expect(r.version).toBe(cli.version);
  });

  it('ships every command as a named skill and no commands/ directory', async () => {
    await built();
    expect(fs.existsSync(path.join(out, 'commands'))).toBe(false);
    for (const file of fs.readdirSync(path.join(ROOT, 'framwork', '.claude', 'commands'))) {
      const name = file.replace(/\.md$/, '');
      const skill = fs.readFileSync(path.join(out, 'skills', name, 'SKILL.md'), 'utf8');
      expect(skill.startsWith(`---\nname: ${name}\n`)).toBe(true);
    }
  });

  it('leaves no installed-project path to a resource the plugin ships', async () => {
    await built();
    const names = [
      ...fs.readdirSync(path.join(out, 'skills')),
      ...fs.readdirSync(path.join(out, 'agents')).map((f) => f.replace(/\.md$/, '')),
    ];
    const stale = new RegExp(`(?<![\\w~/.$-])\\.claude/(skills|commands|agents)/(${names.join('|')})\\b`);
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.md') && stale.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(out, p));
      }
    };
    walk(out);
    expect(offenders).toEqual([]);
  });

  it('dispatches agents by their namespaced name', async () => {
    await built();
    const build = fs.readFileSync(path.join(out, 'skills', 'add-build', 'SKILL.md'), 'utf8');
    expect(build).toMatch(new RegExp(`@${PLUGIN_NAME}:[a-z-]+-agent`));
    expect(build).not.toMatch(/(?<![\w:@/-])@(fix|reviewer|backend|frontend)-agent\b/);
  });

  it('ships the SessionStart hook, which reports and never fails the session', async () => {
    await built();
    const hooks = JSON.parse(fs.readFileSync(path.join(out, 'hooks', 'hooks.json'), 'utf8'));
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cjs');

    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-plugin-project-'));
    try {
      const res = spawnSync(process.execPath, [path.join(out, 'hooks', 'session-start.cjs')], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: out, CLAUDE_PROJECT_DIR: project, CODEADD_PLUGIN_BOOTSTRAP: '0' },
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Code Addiction (ADD) plugin is active.');
      expect(res.stdout).toContain('bootstrap is off');
      expect(fs.existsSync(path.join(project, '.codeadd'))).toBe(false);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
