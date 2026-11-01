import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyPackageTree } from '../scripts/sync-branch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const script = path.join(integrationRoot, 'scripts', 'sync-branch.mjs');

function runSync(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function buildPackage() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-branch-test-'));
  const result = runSync(['--dry-run', '--json', '--out', out]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { out, receipt: JSON.parse(result.stdout) };
}

function headCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('builds an installable package tree from the pinned source commit', () => {
  const { out, receipt } = buildPackage();
  try {
    assert.equal(receipt.packageName, '@whisssssss/dsh-archify');
    assert.equal(receipt.packageVersion, '1.0.0');
    assert.equal(receipt.sourceCommit, headCommit());
    assert.match(receipt.commit, /^[a-f0-9]{40}$/);
    assert.match(receipt.tree, /^[a-f0-9]{40}$/);
    assert.ok(receipt.fileCount > 200);
    assert.ok(receipt.skillFileCount > 190);
    assert.ok(receipt.bytes > 10 * 1024 * 1024);
    assert.equal(receipt.dryRun, true);

    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@whisssssss/dsh-archify');
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
    assert.equal(Object.keys(manifest.scripts || {}).length, 0);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      assert.equal(Object.hasOwn(manifest, field), false, field);
    }

    const patch = fs.readFileSync(path.join(out, 'cordis.patch.yml'), 'utf8');
    assert.match(patch, /providerName:\s*archify-plugin/);
    assert.match(patch, /includeDefaultRoots:\s*true/);
    assert.match(patch, /createRequire\(baseUrl\)\.resolve\('@whisssssss\/dsh-archify\/package\.json'\)/);
    assert.doesNotMatch(patch, /@tt-a1i\/archify-dsh/);

    const release = JSON.parse(fs.readFileSync(path.join(out, 'release.json'), 'utf8'));
    assert.equal(release.sourceCommit, receipt.sourceCommit);
    assert.equal(release.skillVersion, receipt.skillVersion);
    assert.equal(release.dshVersion, '0.2.1-rc.5');
    assert.equal(release.dshSupport, '>=0.2.0-rc.2');

    const skill = fs.readFileSync(path.join(out, 'skills', 'archify', 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: archify\n/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'skills', 'archify', 'skill-release.json'), 'utf8')).version, receipt.skillVersion);

    assert.equal(fs.existsSync(path.join(out, '.git')), false, 'the package tree must not carry the build repository');
    assert.equal(fs.existsSync(path.join(out, 'skills', 'archify', 'test')), false, 'development tests must not ship');
    assert.equal(fs.existsSync(path.join(out, 'skills', 'archify', 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(out, 'skills', 'archify', 'package-lock.json')), false);
    assert.equal(fs.existsSync(path.join(out, 'skills', 'archify', 'scripts', 'generate-validators.mjs')), false);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('rebuilding the same source is deterministic', () => {
  const first = buildPackage();
  const second = buildPackage();
  try {
    assert.equal(first.receipt.commit, second.receipt.commit);
    assert.equal(first.receipt.tree, second.receipt.tree);
    assert.equal(first.receipt.skillVersion, second.receipt.skillVersion);
  } finally {
    fs.rmSync(first.out, { recursive: true, force: true });
    fs.rmSync(second.out, { recursive: true, force: true });
  }
});

test('refuses to write the package over main or master', () => {
  for (const branch of ['main', 'master', 'HEAD']) {
    const result = runSync(['--dry-run', '--branch', branch]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to write the package/);
  }
});

test('verifyPackageTree rejects an incomplete package tree', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-empty-'));
  try {
    assert.throws(() => verifyPackageTree(empty), /missing required file/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
