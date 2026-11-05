import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EXPECTED_FILES, readZip, verifyVsix } from '../../scripts/verify-vsix.mts';

/** Writes a real zip, so the reader is tested against the format rather than itself. */
function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const good = (overrides: Record<string, string | undefined> = {}): Buffer => {
  const entries: Record<string, string | undefined> = {
    ...Object.fromEntries(EXPECTED_FILES.map(name => [name, 'x'])),
    'extension/package.json': JSON.stringify({ publisher: 'vs-publisher-473885', name: 'parked-prompts', version: '1.0.7' }),
    'extension/dist/extension.cjs': 'var a=require("vscode"),b=require("node:fs"),c=require("path");',
    ...overrides,
  };
  return makeZip(Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, string] => entry[1] !== undefined)));
};

describe('verifyVsix', () => {
  it('accepts a good package', () => {
    expect(verifyVsix(good(), { version: '1.0.7', preRelease: false })).toEqual([]);
  });

  it('reads the files back', () => {
    expect(readZip(makeZip({ 'a.txt': 'hello' })).get('a.txt')?.toString()).toBe('hello');
  });

  it('refuses anything that is not a zip', () => {
    expect(() => verifyVsix(Buffer.from('not a zip, but long enough to be searched for one'))).toThrow(/not a zip/);
  });

  it.each(['extension/dist/extension.cjs.map', 'extension/src/extension.ts', 'extension/.env', 'extension/media/screenshots/a.png', 'extension/node_modules/x/index.js'])('refuses the extra file %s', name => {
    expect(verifyVsix(good({ [name]: 'x' }))).toEqual([`Unexpected file ${name}.`]);
  });

  it('refuses a package missing a file', () => {
    expect(verifyVsix(good({ 'extension/dist/webview.js': undefined }))).toEqual(['Missing extension/dist/webview.js.']);
  });

  it('refuses the wrong version', () => {
    expect(verifyVsix(good(), { version: '1.0.8' })).toEqual(['The version is 1.0.7, not 1.0.8.']);
  });

  it('refuses the wrong extension ID, which would publish somewhere else', () => {
    const manifest = JSON.stringify({ publisher: 'someone-else', name: 'parked-prompts', version: '1.0.7' });
    expect(verifyVsix(good({ 'extension/package.json': manifest }))[0]).toContain('someone-else.parked-prompts');
  });

  it('checks the release channel both ways', () => {
    const preRelease = good({ 'extension.vsixmanifest': '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" />' });
    expect(verifyVsix(preRelease, { preRelease: true })).toEqual([]);
    expect(verifyVsix(preRelease, { preRelease: false })[0]).toContain('should not be');
    expect(verifyVsix(good(), { preRelease: true })[0]).toContain('should be marked');
  });

  it('accepts a listing whose images load from the extension folder', () => {
    const base = 'https://github.com/jamesmontemagno/parked-prompts/raw/HEAD/packages/extension/media/screenshots';
    const readme = `![a](${base}/a.png)\n<img src="${base}/b.png">`;
    expect(verifyVsix(good({ 'extension/readme.md': readme }))).toEqual([]);
  });

  it.each([
    'https://github.com/jamesmontemagno/parked-prompts/raw/HEAD/media/screenshots/a.png',
    'media/screenshots/a.png',
  ])('refuses a listing image that will not load: %s', url => {
    expect(verifyVsix(good({ 'extension/readme.md': `![a](${url})` }))[0]).toContain('will not load');
    expect(verifyVsix(good({ 'extension/readme.md': `<img src="${url}">` }))[0]).toContain('will not load');
  });

  it('refuses a bundle that still needs a package at run time', () => {
    const bundle = 'require("vscode");require("@parked-prompts/core");require("yaml/dist");';
    expect(verifyVsix(good({ 'extension/dist/extension.cjs': bundle }))).toEqual(['The bundle still needs @parked-prompts/core, yaml/dist.']);
  });

  it('refuses a bundle pointing at a source map it does not ship', () => {
    expect(verifyVsix(good({ 'extension/dist/extension.cjs': '//# sourceMappingURL=extension.cjs.map' }))).toHaveLength(1);
  });
});
