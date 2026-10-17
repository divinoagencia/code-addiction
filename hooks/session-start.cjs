#!/usr/bin/env node
'use strict';
/**
 * session-start.cjs — SessionStart hook of the Code Addiction Claude Code plugin.
 *
 * The plugin carries the commands, skills and agents. The runtime core they call
 * (`node .codeadd/scripts/status.cjs`, templates, sidecars) belongs to the
 * project, exactly as after `npx codeadd install`. When the project has no core
 * yet, this hook installs it with the CLI, core only (`--providers none`) and
 * pinned to the framework release the plugin was built from (`--version`), so a
 * cloud session with no terminal still gets a working framework. The CLI itself
 * is `latest`: a release that changes nothing under cli/ publishes no npm
 * version, while every release has its framework tag. It never touches an
 * existing installation.
 *
 * Opt out with CODEADD_PLUGIN_BOOTSTRAP=0 (the hook then only reports).
 *
 * Output: plain text on stdout, which Claude Code adds to the session context.
 * The hook always exits 0, so a failed bootstrap never blocks the session.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function installedVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, '.codeadd', 'manifest.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

function hasCore() {
  return fs.existsSync(path.join(PROJECT_DIR, '.codeadd', 'scripts', 'status.cjs'));
}

function bootstrap(version) {
  const args = ['-y', 'codeadd@latest', 'install', '--providers', 'none', '--version', `v${version}`];
  const res = spawnSync('npx', args, {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 170_000,
  });
  return { ok: res.status === 0 && hasCore(), detail: (res.error?.message || res.stderr || '').trim().split('\n').slice(-3).join(' ') };
}

function main() {
  const version = pluginVersion();
  const lines = [
    'Code Addiction (ADD) plugin is active.',
    'Its commands are plugin skills: `/add-new` (or `/codeadd:add-new`), `/add-plan`, `/add-build`, `/add-review`, `/add-done`, `/add-help` and the rest.',
    'Its agents are namespaced: when an ADD command says to dispatch `@codeadd:<name>-agent`, use that exact name as the subagent type.',
  ];

  if (hasCore()) {
    const installed = installedVersion();
    if (installed && version && installed !== version) {
      lines.push(`The project's ADD runtime core (.codeadd/) is v${installed} and the plugin is v${version}. Mention it once; \`npx codeadd update\` aligns the core.`);
    }
  } else if (!version) {
    lines.push('The ADD runtime core (.codeadd/) is missing and the plugin version is unreadable. Ask the user to run `npx codeadd install --providers none`.');
  } else if (process.env.CODEADD_PLUGIN_BOOTSTRAP === '0') {
    lines.push(`The ADD runtime core (.codeadd/) is missing and bootstrap is off (CODEADD_PLUGIN_BOOTSTRAP=0). ADD commands need it: \`npx codeadd install --providers none --version v${version}\`.`);
  } else if (!fs.existsSync(path.join(PROJECT_DIR, '.git'))) {
    lines.push('The ADD runtime core (.codeadd/) is missing and this folder is not a git repository, so it was not installed. ADD commands need a git project.');
  } else {
    const res = bootstrap(version);
    lines.push(res.ok
      ? `The ADD runtime core v${version} was just installed into .codeadd/ (core only, no provider files). Tell the user once, and that .gitignore gained the ADD block.`
      : `Installing the ADD runtime core failed (${res.detail || 'no output'}). ADD commands need it: \`npx codeadd install --providers none --version v${version}\`.`);
  }

  process.stdout.write(lines.join('\n') + '\n');
}

try {
  main();
} catch (err) {
  process.stdout.write(`Code Addiction plugin: SessionStart hook error: ${err.message}\n`);
}
process.exit(0);
