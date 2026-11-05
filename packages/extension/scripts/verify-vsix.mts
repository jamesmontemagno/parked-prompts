// Checks a built VSIX before it is published. The file list is exact, so nothing
// private or unintended can ship by accident: anything new has to be added here.
// Run with: node scripts/verify-vsix.mts <file.vsix> [--version 1.0.5] [--pre-release]
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export const EXPECTED_FILES = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/changelog.md',
  'extension/dist/extension.cjs',
  'extension/dist/webview.css',
  'extension/dist/webview.js',
  'extension/media/activity.svg',
  'extension/media/icon.png',
  'extension/package.json',
  'extension/readme.md',
];

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSION_ID = 'vs-publisher-473885.parked-prompts';
const LISTING_IMAGES = 'https://github.com/jamesmontemagno/parked-prompts/raw/HEAD/packages/extension/media/screenshots/';

/** Reads a zip's central directory. VSIX files are plain zips, so this needs no dependency. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('This is not a zip file.');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('The zip directory is damaged.');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeader = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export interface VerifyOptions {
  version?: string | undefined;
  preRelease?: boolean | undefined;
}

/** Returns what is wrong with a VSIX. An empty list means it is fit to publish. */
export function verifyVsix(zip: Buffer, options: VerifyOptions = {}): string[] {
  const problems: string[] = [];
  if (zip.length > MAX_BYTES) problems.push(`It is ${zip.length} bytes, over the ${MAX_BYTES} byte budget.`);
  const files = readZip(zip);
  for (const name of EXPECTED_FILES) if (!files.has(name)) problems.push(`Missing ${name}.`);
  for (const name of files.keys()) if (!EXPECTED_FILES.includes(name)) problems.push(`Unexpected file ${name}.`);

  const manifestText = files.get('extension/package.json')?.toString('utf8');
  if (!manifestText) return problems;
  const manifest = JSON.parse(manifestText) as { publisher?: string; name?: string; version?: string };
  if (`${manifest.publisher}.${manifest.name}` !== EXTENSION_ID) problems.push(`The extension ID is ${manifest.publisher}.${manifest.name}, not ${EXTENSION_ID}.`);
  if (options.version && manifest.version !== options.version) problems.push(`The version is ${manifest.version}, not ${options.version}.`);

  const isPreRelease = files.get('extension.vsixmanifest')?.toString('utf8').includes('Microsoft.VisualStudio.Code.PreRelease') ?? false;
  if (options.preRelease !== undefined && isPreRelease !== options.preRelease) problems.push(isPreRelease ? 'It is marked pre-release, and should not be.' : 'It should be marked pre-release.');

  // The listing loads its images from the repository, and vsce does not know this is a subfolder.
  const readme = files.get('extension/readme.md')?.toString('utf8') ?? '';
  for (const [, url] of readme.matchAll(/(?:\]\(|src=")([^)"\s]+\.(?:png|jpe?g|gif|webp|svg))/g)) {
    if (!url?.startsWith(LISTING_IMAGES)) problems.push(`The listing has an image that will not load: ${url}.`);
  }

  // The bundle must stand alone: only VS Code and Node.js built-ins are left to load at run time.
  const bundle = files.get('extension/dist/extension.cjs')?.toString('utf8') ?? '';
  const required = [...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1] as string);
  const outside = [...new Set(required)].filter(name => name !== 'vscode' && !name.startsWith('node:') && !/^[a-z_]+$/.test(name));
  if (outside.length > 0) problems.push(`The bundle still needs ${outside.join(', ')}.`);
  if (bundle.includes('sourceMappingURL=')) problems.push('The bundle points at a source map that is not shipped.');
  return problems;
}

if (process.argv[1]?.endsWith('verify-vsix.mts')) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: verify-vsix.mts <file.vsix> [--version x.y.z] [--pre-release]');
    process.exit(2);
  }
  const versionAt = flags.indexOf('--version');
  const problems = verifyVsix(readFileSync(file), {
    ...(versionAt >= 0 && { version: flags[versionAt + 1] }),
    preRelease: flags.includes('--pre-release'),
  });
  for (const problem of problems) console.error(`FAIL  ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`OK  ${file}`);
}
