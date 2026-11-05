import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Publishing can only really happen once per version, so CI cannot try it. These tests run
// the real vsce from the lockfile, with the exact command in publish.yml, against a local
// stand-in for GitHub's OIDC endpoint and the Marketplace.

const REPO = resolve(__dirname, '../../../..');
const PUBLISHER = 'vs-publisher-473885';
const NAME = 'parked-prompts';
const VSCE = resolve(__dirname, '../../node_modules/@vscode/vsce/vsce');
const OLD_PAT = 'a-leftover-pat';
const CREDENTIAL = 'marketplace-session-credential';
const GITHUB_JWT = 'github-oidc-jwt';

interface Step { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }
interface Job { permissions?: Record<string, string>; environment?: string | { name: string }; steps: Step[]; if?: string; needs?: string }
const workflow = parse(readFileSync(join(REPO, '.github/workflows/publish.yml'), 'utf8')) as { permissions: Record<string, string>; jobs: Record<string, Job> };
const workflowText = readFileSync(join(REPO, '.github/workflows/publish.yml'), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'parked-publish-'));

function packageFixture(fileName: string, preRelease: boolean): string {
  const dir = mkdtempSync(join(scratch, 'fixture-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: NAME, publisher: PUBLISHER, version: '1.0.7', engines: { vscode: '^1.105.0' } }));
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  const out = join(scratch, fileName);
  const args = [VSCE, 'package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', out, ...(preRelease ? ['--pre-release'] : [])];
  const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return out;
}

interface Seen { method: string; url: string; authorization: string; body: string }

/** What the Marketplace should say. */
interface Scenario {
  exchange: { status: number; body: unknown };
  /** Versions already on the Marketplace. Undefined means the extension does not exist yet. */
  versions?: string[];
}

let server: Server;
let origin: string;
let seen: Seen[];
let scenario: Scenario;

const json = (response: import('node:http').ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const url = request.url ?? '';
      seen.push({ method: request.method ?? '', url, authorization: request.headers.authorization ?? '', body: Buffer.concat(chunks).toString('latin1') });
      if (url.startsWith('/oidc')) return json(response, 200, { value: GITHUB_JWT });
      if (url.startsWith('/_apis/gallery/token')) return json(response, scenario.exchange.status, scenario.exchange.body);
      if (request.method === 'OPTIONS') {
        const route = { area: 'gallery', resourceName: 'extensions', releasedVersion: '7.2', minVersion: '1.0', maxVersion: '7.2', resourceVersion: 3 };
        return json(response, 200, {
          count: 2,
          value: [
            // Looking up and updating an extension share a route. Creating one has its own.
            { ...route, id: 'e11ea35a-16fe-4b80-ab11-c4cab88a0966', routeTemplate: '_apis/gallery/publishers/{publisherName}/extensions/{extensionName}' },
            { ...route, id: 'a41192c8-9525-4b58-bc86-179fa549d80d', routeTemplate: '_apis/gallery/publishers/{publisherName}/extensions' },
          ],
        });
      }
      if (request.method === 'GET') {
        if (!scenario.versions) return json(response, 404, { message: 'Not found' });
        return json(response, 200, { extensionName: NAME, versions: scenario.versions.map(version => ({ version })) });
      }
      return json(response, 200, { extensionName: NAME, versions: [{ version: '1.0.7' }] });
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(done => server.close(done));
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  seen = [];
  scenario = { exchange: { status: 200, body: { credential: CREDENTIAL } } };
});

afterEach(() => {
  // Whatever happens, a stored token never goes anywhere.
  for (const request of seen) {
    const decoded = Buffer.from(request.authorization.replace(/^Basic /, ''), 'base64').toString();
    expect(`${request.authorization} ${decoded}`).not.toContain(OLD_PAT);
  }
});

/** The command in publish.yml, with only the file and the channel filled in. */
function publishCommand(vsix: string, channelFlag: string): string[] {
  const step = workflow.jobs.publish?.steps.find(item => item.name === 'Publish');
  const words = step?.run?.split(/\s+/) ?? [];
  expect(words.slice(0, 3)).toEqual(['pnpm', 'exec', 'vsce']);
  return words.slice(3).flatMap(word => (word === '$CHANNEL_FLAG' ? (channelFlag ? [channelFlag] : []) : word === 'release/parked-prompts.vsix' ? [vsix] : [word]));
}

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, [VSCE, ...args], {
      cwd: scratch,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: scratch,
        USERPROFILE: scratch,
        NO_PROXY: '*',
        GITHUB_ACTIONS: 'true',
        ACTIONS_ID_TOKEN_REQUEST_URL: `${origin}/oidc?api-version=2.0`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-token',
        VSCE_MARKETPLACE_URL: origin,
        VSCE_PAT: OLD_PAT,
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    child.on('close', code => done({ code, output }));
  });
}

const uploads = () => seen.filter(request => request.url.includes('/publishers/') && (request.method === 'POST' || request.method === 'PUT'));

describe('the publish command in publish.yml, against a stand-in Marketplace', () => {
  let stable: string;
  let preRelease: string;

  beforeAll(() => {
    mkdirSync(scratch, { recursive: true });
    stable = packageFixture('stable.vsix', false);
    preRelease = packageFixture('pre.vsix', true);
  }, 120_000);

  it('asks GitHub for a token meant only for the Marketplace', async () => {
    const { code } = await run(publishCommand(stable, ''));
    expect(code).toBe(0);
    const token = seen.find(request => request.url.startsWith('/oidc'));
    expect(new URL(token?.url ?? '', origin).searchParams.get('audience')).toBe('marketplace.visualstudio.com');
    expect(token?.authorization).toContain('runner-token');
  }, 60_000);

  it('trades it for a credential for this publisher, read from the VSIX', async () => {
    await run(publishCommand(stable, ''));
    const exchange = seen.find(request => request.url.startsWith('/_apis/gallery/token'));
    expect(exchange).toMatchObject({ method: 'POST', authorization: `FederatedToken ${GITHUB_JWT}` });
    expect(JSON.parse(exchange?.body ?? '{}')).toEqual({ publisherName: PUBLISHER });
  }, 60_000);

  it('creates a new extension with that credential, and not a leftover token', async () => {
    const { code, output } = await run(publishCommand(stable, ''));
    expect(code, output).toBe(0);
    const [upload] = uploads();
    expect(upload?.method).toBe('POST');
    expect(Buffer.from((upload?.authorization ?? '').replace(/^Basic /, ''), 'base64').toString()).toContain(CREDENTIAL);
    expect(upload?.body).toContain('extension.vsixmanifest');
  }, 60_000);

  it('updates an extension that already exists', async () => {
    scenario.versions = ['1.0.6'];
    const { code, output } = await run(publishCommand(stable, ''));
    expect(code, output).toBe(0);
    expect(uploads().map(request => request.method)).toEqual(['PUT']);
  }, 60_000);

  it('lets a re-run finish when the version already went out', async () => {
    scenario.versions = ['1.0.7'];
    const { code, output } = await run(publishCommand(stable, ''));
    expect(code, output).toBe(0);
    expect(output).toContain('already published');
    expect(uploads()).toEqual([]);
  }, 60_000);

  it('publishes to the pre-release channel', async () => {
    const { code, output } = await run(publishCommand(preRelease, '--pre-release'));
    expect(code, output).toBe(0);
    expect(uploads()).toHaveLength(1);
  }, 60_000);

  it('will not put a stable package on the pre-release channel', async () => {
    const { code } = await run(publishCommand(stable, '--pre-release'));
    expect(code).not.toBe(0);
    expect(seen).toEqual([]);
  }, 60_000);

  it('stops with the Marketplace\'s reason when there is no matching policy', async () => {
    scenario.exchange = { status: 403, body: { message: 'No trusted publishing policy matches this workflow.' } };
    const { code, output } = await run(publishCommand(stable, ''));
    expect(code).not.toBe(0);
    expect(output).toContain('No trusted publishing policy matches this workflow.');
    expect(uploads()).toEqual([]);
  }, 60_000);

  it('says what to fix when the job cannot request a token', async () => {
    const { code, output } = await run(publishCommand(stable, ''), { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' });
    expect(code).not.toBe(0);
    expect(output).toContain('id-token: write');
    expect(seen).toEqual([]);
  }, 60_000);
});

describe('what publish.yml is allowed to do', () => {
  const jobs = Object.entries(workflow.jobs);
  const environmentOf = (job: Job | undefined) => (typeof job?.environment === 'string' ? job.environment : job?.environment?.name);

  it('stores no token', () => {
    expect(workflowText).not.toMatch(/secrets\./);
    expect(workflowText).not.toMatch(/--pat\b/);
  });

  it('lets only the publishing jobs mint a token', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const minting = jobs.filter(([, job]) => job.permissions?.['id-token']).map(([name]) => name);
    expect(minting.sort()).toEqual(['open-vsx', 'publish']);
  });

  // The Marketplace policy names these. Changing one means changing the policy too.
  it('keeps the file and environment the Marketplace policy names', () => {
    expect(environmentOf(workflow.jobs.publish)).toBe('marketplace');
    expect(environmentOf(workflow.jobs['open-vsx'])).toBe('open-vsx');
    const releasing = readFileSync(join(REPO, 'RELEASING.md'), 'utf8');
    expect(releasing).toContain('| **Workflow** | `publish.yml` |');
    expect(releasing).toContain('| **Environment** | `marketplace` |');
  });

  it.each(['publish', 'open-vsx'])('keeps the %s job down to what it needs', name => {
    const job = workflow.jobs[name];
    expect(job?.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    for (const step of job?.steps ?? []) {
      // Every action is pinned to a commit, and none is a third party's release helper.
      if (step.uses) expect(step.uses).toMatch(/^(actions|pnpm)\/[\w-]+@[0-9a-f]{40}$/);
      // A restored cache could carry something in from a less trusted run.
      expect(step.with?.cache).toBeUndefined();
      // No build or test runs here, and neither does a tool the lockfile does not cover.
      if (step.run) expect(step.run).toMatch(/^(pnpm install --frozen-lockfile --filter parked-prompts|node scripts\/verify-vsix\.mts |pnpm exec (vsce|ovsx) publish )/);
    }
  });

  it('releases on GitHub from a job that cannot mint a token', () => {
    expect(workflow.jobs.release?.permissions).toEqual({ contents: 'write' });
    expect(workflow.jobs.release?.needs).toBe('publish');
    for (const [name, job] of jobs) {
      if (name !== 'release') expect(job.steps.some(step => step.uses?.startsWith('softprops/')), name).toBe(false);
    }
  });

  it('only runs Open VSX when it has been turned on, and after the Marketplace', () => {
    expect(workflow.jobs['open-vsx']?.if).toBe("vars.PUBLISH_OPEN_VSX == 'true'");
    expect(workflow.jobs['open-vsx']?.needs).toBe('publish');
    expect(workflow.jobs['open-vsx']?.steps.at(-1)?.run).toContain('--trusted-publishing');
  });

  it('never lets a build job skip the tests', () => {
    expect(workflow.jobs.package?.needs).toBe('verify');
    expect(workflow.jobs.publish?.needs).toBe('package');
  });
});

describe('canvas publishing triggers', () => {
  it('runs for every main push so a newer non-canvas commit cannot strand a skipped release', () => {
    const canvasWorkflow = parse(readFileSync(join(REPO, '.github/workflows/publish-canvas.yml'), 'utf8')) as {
      on: { push: { branches: string[]; paths?: string[]; 'paths-ignore'?: string[] }; workflow_dispatch: unknown };
    };
    expect(canvasWorkflow.on.push.branches).toEqual(['main']);
    expect(canvasWorkflow.on.push.paths).toBeUndefined();
    expect(canvasWorkflow.on.push['paths-ignore']).toBeUndefined();
    expect(canvasWorkflow.on).toHaveProperty('workflow_dispatch');
  });
});
