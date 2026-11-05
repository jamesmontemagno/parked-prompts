import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isImageFile, resolveAttachments } from './attachments.ts';
import { ParkedPromptsError } from './errors.ts';
import { serializePrompt } from './frontmatter.ts';
import { copyFileWithHash, formatBytes, pathExists, rename } from './fsutil.ts';
import { repoStoreRoot } from './paths.ts';
import { ATTACHMENTS_DIR, PROMPT_FILE, type PromptStore } from './store.ts';
import { contentHash } from './trust.ts';
import type { ParkedPrompt, PromptMeta } from './types.ts';

interface SecretPattern {
  label: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { label: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { label: 'a private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { label: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'an OpenAI or Anthropic key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'a Google API key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { label: 'a bearer token', pattern: /\bbearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { label: 'a password or secret value', pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?[^\s"'<>{}]{6,}/i },
  { label: 'credentials in a URL', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
];

export interface SecretFinding {
  label: string;
  line: number;
}

/** Reports what looks like a secret and where. It never returns the matched text, so a warning cannot leak it. */
export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push({ label, line: index + 1 });
    }
  });
  return findings;
}

const MAX_SCAN_BYTES = 1024 * 1024;
const TEXT_MIME = /^(?:text\/|application\/(?:json|xml|x-yaml|yaml|javascript))/;

export interface PlannedFile {
  /** Path relative to the repository root. */
  path: string;
  size: number;
  kind: 'prompt' | 'image' | 'file';
}

export interface MovePlan {
  hash: string;
  targetDir: string;
  files: PlannedFile[];
  /** Workspace files that stay references, and are not copied. */
  references: string[];
  warnings: string[];
  /** Attachments that cannot be moved. The move is refused while there are any. */
  blockers: string[];
}

const toPosix = (path: string) => path.replace(/\\/g, '/');

/** What a shared prompt looks like: it keeps the remote and drops the path of this machine's checkout. */
function sharedMeta(prompt: ParkedPrompt, attachments: PromptMeta['attachments']): PromptMeta {
  const { id, title, createdAt, updatedAt, mode, model, repo } = prompt;
  return {
    id,
    title,
    createdAt,
    updatedAt,
    status: 'parked',
    ...(repo?.remote && { repo: { remote: repo.remote } }),
    ...(mode && { mode }),
    ...(model && { model }),
    attachments,
  };
}

/** Lists exactly what moving a prompt to the repo store would add to the repository. */
export async function planMoveToRepo(prompt: ParkedPrompt, repoRoot: string): Promise<MovePlan> {
  if (prompt.store !== 'global') throw new ParkedPromptsError('invalid_input', 'This prompt is already in the repo store.');
  const relativeDir = `.github/parked-prompts/${prompt.id}`;
  const shared = serializePrompt(sharedMeta(prompt, prompt.attachments), prompt.body);
  const files: PlannedFile[] = [{ path: `${relativeDir}/${PROMPT_FILE}`, size: Buffer.byteLength(shared), kind: 'prompt' }];
  const references: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const findings = [
    ...scanForSecrets(prompt.title).map(finding => `The prompt title may contain ${finding.label}.`),
    ...scanForSecrets(prompt.body).map(finding => `The prompt text may contain ${finding.label} (line ${finding.line}).`),
  ];

  const { resolved, missing } = await resolveAttachments(prompt, undefined);
  let images = 0;
  for (const item of resolved) {
    const { attachment } = item;
    if (attachment.kind !== 'copy') continue;
    const image = isImageFile(item.absolutePath);
    if (image) images += 1;
    files.push({ path: `${relativeDir}/${attachment.path}`, size: attachment.size, kind: image ? 'image' : 'file' });
    if (!image && attachment.size <= MAX_SCAN_BYTES && TEXT_MIME.test(attachment.mime)) {
      const contents = await readFile(item.absolutePath, 'utf8').catch(() => '');
      for (const finding of scanForSecrets(contents)) findings.push(`${attachment.name} may contain ${finding.label} (line ${finding.line}).`);
    }
  }
  for (const item of missing) {
    if (item.attachment.kind === 'workspace') references.push(item.name);
    else blockers.push(`${item.name} cannot be moved: its copy is missing or not allowed.`);
  }
  if (images > 0) warnings.push(`${images} image${images === 1 ? '' : 's'} will be committed. Check that no screenshot shows anything private.`);
  warnings.push(...findings);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 5 * 1024 * 1024) warnings.push(`This adds ${formatBytes(total)} to the repository's history.`);
  return { hash: await contentHash(prompt), targetDir: toPosix(join(repoRoot, relativeDir)), files, references, warnings, blockers };
}

/**
 * Moves a prompt from the global store to the repository. `expectedHash` must come
 * from the plan the user saw, so nothing different is ever written. It never commits;
 * the files are left for the user to review and commit.
 */
export async function moveToRepo(global: PromptStore, repoStore: PromptStore, id: string, repoRoot: string, expectedHash: string): Promise<ParkedPrompt> {
  if (repoStore.root !== repoStoreRoot(repoRoot)) throw new ParkedPromptsError('invalid_input', 'The repo store does not belong to this repository.');
  const prompt = await global.get(id);
  const plan = await planMoveToRepo(prompt, repoRoot);
  if (plan.hash !== expectedHash) throw new ParkedPromptsError('changed', 'The prompt changed after you reviewed it. Review it again.');
  if (plan.blockers.length > 0) throw new ParkedPromptsError('invalid_input', plan.blockers.join(' '));
  const dir = join(repoStore.root, id);
  if (await pathExists(dir)) throw new ParkedPromptsError('already_exists', `The repo store already has a prompt with the ID ${id}.`);

  await mkdir(repoStore.root, { recursive: true, mode: 0o755 });
  const temp = join(repoStore.root, `.tmp-${id}-${randomBytes(3).toString('hex')}`);
  try {
    await mkdir(join(temp, ATTACHMENTS_DIR), { recursive: true, mode: 0o755 });
    const { resolved } = await resolveAttachments(prompt, undefined);
    for (const item of resolved) {
      const info = await lstat(item.absolutePath);
      await copyFileWithHash(item.absolutePath, join(temp, ATTACHMENTS_DIR, basename(item.attachment.path)), Math.max(info.size, 1), 0o644);
    }
    await writeFile(join(temp, PROMPT_FILE), serializePrompt(sharedMeta(prompt, prompt.attachments), prompt.body), { mode: 0o644 });
    await rename(temp, dir);
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await global.delete(id);
  return repoStore.get(id);
}
