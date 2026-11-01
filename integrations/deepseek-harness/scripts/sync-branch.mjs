#!/usr/bin/env node
// Build (and optionally publish) the git-installable DSH package branch.
//
// The package branch is an orphan branch (default: `dsh`) that contains ONLY
// the installable package: adapter files, a cleanly staged Skill tree, release
// metadata and license notices. It has no `prepare`/`install` scripts, so
// `dsh plugin add 'github:<owner>/<repo>#<branch>'` never needs pnpm's
// `allowBuilds` allowance (git dependencies are unpacked from a tarball that
// has no `.git`, so a git-driven staging script cannot run there).
//
// The branch is rebuilt from a single immutable source commit. Rebuilding the
// same source produces the same tree (and commit) because the commit dates are
// pinned to the source commit's author date.
//
// Usage:
//   node integrations/deepseek-harness/scripts/sync-branch.mjs [options]
//
// Options:
//   --source-commit <sha>  Source commit to build from   (default: HEAD)
//   --branch <name>        Package branch to update      (default: dsh)
//   --out <dir>            Copy the built package tree to <dir> (kept)
//   --dry-run              Build and verify without writing the local ref
//   --push                 Push the rebuilt branch to the remote
//   --remote <name>        Remote for --push            (default: origin)
//   --json                 Print the machine-readable receipt on stdout
//
// Exit code 0 means the package tree was built and every contract below held.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule, stageCleanSkill } from '../../../scripts/stage-clean-skill.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(scriptRoot, '..', '..');
const branchTemplateRoot = path.join(scriptRoot, 'branch');
const config = JSON.parse(fs.readFileSync(path.join(branchTemplateRoot, 'release-config.json'), 'utf8'));
const templateManifest = JSON.parse(fs.readFileSync(path.join(branchTemplateRoot, 'package.json'), 'utf8'));

const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'release.json',
  'skills/archify/SKILL.md',
  'skills/archify/package.json',
  'skills/archify/skill-release.json',
];

function argument(flag, fallback = undefined) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) fail(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited ${result.status}: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}

function git(args, options = {}) {
  return run('git', args, { cwd: repoRoot, ...options }).trim();
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else fail(`package tree contains a non-regular entry: ${relative}`);
  }
  return files.sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertPackageManifest(packageDir) {
  const manifest = readJson(path.join(packageDir, 'package.json'));
  if (manifest.name !== config.packageName) {
    fail(`package name must be ${config.packageName}, got ${manifest.name}`);
  }
  if (manifest.version !== templateManifest.version) {
    fail(`package version drift: template ${templateManifest.version}, built ${manifest.version}`);
  }
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    fail('package manifest must declare dsh.bundle.patch ./cordis.patch.yml');
  }
  if (Object.keys(manifest.scripts || {}).length > 0) {
    fail('package branch must not declare npm scripts (no build step is allowed on install)');
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (manifest[field] !== undefined) fail(`package branch must not declare ${field}`);
  }
  return manifest;
}

function assertPatch(packageDir) {
  const patch = fs.readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8');
  const expectations = [
    /^- insert:/m,
    /id:\s*archify-skill-filesystem/,
    /providerName:\s*archify-plugin/,
    /includeDefaultRoots:\s*true/,
    /bundledSkillDir:\s*!!js/,
  ];
  for (const pattern of expectations) {
    if (!pattern.test(patch)) fail(`cordis.patch.yml is missing ${pattern}`);
  }
  const expectedResolve = `createRequire(baseUrl).resolve('${config.packageName}/package.json')`;
  if (!patch.includes(expectedResolve)) {
    fail(`cordis.patch.yml must resolve ${config.packageName} from the profile baseUrl`);
  }
  if (patch.includes(config.upstreamPackageName)) {
    fail('cordis.patch.yml still references the upstream package identity');
  }
  return patch;
}

function buildPackageTree(destination, sourceCommit) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-worktree-'));
  fs.rmSync(worktree, { recursive: true, force: true });

  try {
    git(['worktree', 'add', '--detach', '--force', worktree, sourceCommit]);
    // Stage the clean Skill from the pinned source commit, never from the caller's
    // working tree, so uncommitted edits cannot leak into the package branch.
    stageCleanSkill({ repoRoot: worktree, destination: path.join(destination, 'skills', 'archify') });
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktree]);
    } catch {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
    if (fs.existsSync(worktree)) fs.rmSync(worktree, { recursive: true, force: true });
  }

  for (const file of ['package.json', 'README.md', 'CHANGELOG.md']) {
    fs.copyFileSync(path.join(branchTemplateRoot, file), path.join(destination, file));
  }
  fs.copyFileSync(path.join(scriptRoot, 'LICENSE'), path.join(destination, 'LICENSE'));
  fs.copyFileSync(
    path.join(destination, 'skills', 'archify', 'THIRD_PARTY_NOTICES.md'),
    path.join(destination, 'THIRD_PARTY_NOTICES.md'),
  );

  const upstreamPatch = fs.readFileSync(path.join(scriptRoot, 'cordis.patch.yml'), 'utf8');
  writeFile(
    path.join(destination, 'cordis.patch.yml'),
    upstreamPatch.split(config.upstreamPackageName).join(config.packageName),
  );

  const upstreamLib = fs.readFileSync(path.join(scriptRoot, 'lib', 'index.js'), 'utf8');
  writeFile(path.join(destination, 'lib', 'index.js'), upstreamLib.split(config.upstreamPackageName).join(config.packageName));

  const skillRelease = readJson(path.join(destination, 'skills', 'archify', 'skill-release.json'));
  const skillManifest = readJson(path.join(destination, 'skills', 'archify', 'package.json'));
  if (skillRelease.version !== skillManifest.version) {
    fail(`Skill version mismatch: skill-release.json ${skillRelease.version}, package.json ${skillManifest.version}`);
  }

  writeFile(path.join(destination, 'release.json'), `${JSON.stringify({
    sourceCommit,
    skillVersion: skillRelease.version,
    dshVersion: config.dshVersion,
    dshSupport: config.dshSupport,
  }, null, 2)}\n`);

  return { skillVersion: skillRelease.version };
}

function verifyPackageTree(packageDir) {
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!fs.existsSync(path.join(packageDir, ...required.split('/')))) {
      fail(`built package is missing required file: ${required}`);
    }
  }
  const manifest = assertPackageManifest(packageDir);
  assertPatch(packageDir);
  const release = readJson(path.join(packageDir, 'release.json'));
  if (!/^[a-f0-9]{40}$/.test(release.sourceCommit)) fail('release.json sourceCommit must be a full commit');
  if (release.skillVersion !== readJson(path.join(packageDir, 'skills', 'archify', 'skill-release.json')).version) {
    fail('release.json skillVersion does not match the bundled Skill');
  }
  if (release.dshVersion !== config.dshVersion) fail('release.json dshVersion drifted from the release config');
  return { manifest, release };
}

function commitPackageTree(packageDir, sourceCommit, branch) {
  const pinnedDate = git(['log', '-1', '--format=%aI', sourceCommit]);
  const shortSource = sourceCommit.slice(0, 12);
  const message = `release: Archify ${readJson(path.join(packageDir, 'release.json')).skillVersion} from main@${shortSource}`;
  const configArgs = [
    '-c', 'core.autocrlf=false',
    '-c', 'core.safecrlf=false',
    '-c', 'commit.gpgsign=false',
    '-c', 'user.name=' + gitConfig('user.name'),
    '-c', 'user.email=' + gitConfig('user.email'),
  ];
  run('git', ['init', '--quiet'], { cwd: packageDir });
  run('git', ['add', '--all', '--force'], { cwd: packageDir });
  run('git', [...configArgs, 'commit', '--quiet', '--no-gpg-sign', '-m', message], {
    cwd: packageDir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: pinnedDate,
      GIT_COMMITTER_DATE: pinnedDate,
      GIT_AUTHOR_NAME: gitConfig('user.name'),
      GIT_AUTHOR_EMAIL: gitConfig('user.email'),
      GIT_COMMITTER_NAME: gitConfig('user.name'),
      GIT_COMMITTER_EMAIL: gitConfig('user.email'),
    },
  });
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: packageDir }).trim();
  const tree = run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: packageDir }).trim();
  if (branch !== undefined) {
    // Fetch the orphan commit's objects into the repository that owns the branch.
    git(['fetch', '--no-tags', '--quiet', packageDir, commit]);
    git(['update-ref', `refs/heads/${branch}`, commit]);
  }
  return { commit, tree, message };
}

function gitConfig(key) {
  const value = git(['config', '--get', key]);
  if (!value) fail(`git config ${key} is required to build the package branch`);
  return value;
}

function pushBranch(branch, remote) {
  const localRef = `refs/heads/${branch}`;
  const remoteRef = `refs/heads/${branch}`;
  const localSha = git(['rev-parse', localRef]);
  const existing = git(['ls-remote', '--heads', remote, remoteRef]);
  const remoteSha = existing === '' ? undefined : existing.split(/\s+/)[0];
  if (remoteSha === undefined) {
    git(['push', '--quiet', remote, `${localRef}:${remoteRef}`]);
    return { pushed: true, remoteRef, replaced: null };
  }
  if (remoteSha === localSha) return { pushed: false, remoteRef, replaced: remoteSha };
  git(['push', '--quiet', `--force-with-lease=${remoteRef}:${remoteSha}`, remote, `${localRef}:${remoteRef}`]);
  return { pushed: true, remoteRef, replaced: remoteSha };
}

function main() {
  const sourceCommit = git(['rev-parse', '--verify', argument('--source-commit', 'HEAD')]);
  const branch = argument('--branch', config.branch);
  const remote = argument('--remote', 'origin');
  const out = argument('--out');
  const dryRun = hasFlag('--dry-run');
  const shouldPush = hasFlag('--push');
  const asJson = hasFlag('--json');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(branch) || ['main', 'master', 'HEAD'].includes(branch)) {
    fail(`refusing to write the package into branch ${JSON.stringify(branch)}; use a dedicated branch name`);
  }

  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-branch-'));
  const packageDir = path.join(buildRoot, 'package');
  fs.mkdirSync(packageDir, { recursive: true });

  try {
    const { skillVersion } = buildPackageTree(packageDir, sourceCommit);
    verifyPackageTree(packageDir);
    const files = listFiles(packageDir);
    const bytes = files.reduce((total, file) => total + fs.statSync(path.join(packageDir, file)).size, 0);
    const { commit, tree, message } = commitPackageTree(packageDir, sourceCommit, dryRun ? undefined : branch);
    let pushResult = { pushed: false, remoteRef: null, replaced: null };
    if (shouldPush) {
      if (dryRun) fail('--push cannot be combined with --dry-run');
      pushResult = pushBranch(branch, remote);
    }
    if (out !== undefined) {
      const outPath = path.resolve(out);
      fs.rmSync(outPath, { recursive: true, force: true });
      // The build repository's .git is an implementation detail; never publish it.
      fs.cpSync(packageDir, outPath, {
        recursive: true,
        filter: (source) => path.basename(source) !== '.git',
      });
    }
    const receipt = {
      branch,
      commit,
      tree,
      message,
      sourceCommit,
      skillVersion,
      dshVersion: config.dshVersion,
      dshSupport: config.dshSupport,
      packageName: config.packageName,
      packageVersion: templateManifest.version,
      fileCount: files.length,
      bytes,
      skillFileCount: listFiles(path.join(packageDir, 'skills')).length,
      dryRun,
      ...pushResult,
    };
    if (asJson) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    else process.stdout.write(`${branch} ${commit} (skill ${skillVersion}, ${files.length} files)\n`);
    return receipt;
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
}

if (isMainModule({ argvPath: process.argv[1], modulePath: fileURLToPath(import.meta.url) })) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`sync-branch: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { buildPackageTree, verifyPackageTree, commitPackageTree, pushBranch };
