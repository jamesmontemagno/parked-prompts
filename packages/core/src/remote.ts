const SCHEMES = new Set(['https', 'http', 'ssh', 'git', 'git+ssh', 'git+https']);
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;

const stripSuffix = (path: string) =>
  path
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .replace(/^\/+/, '');

function canonical(host: string, path: string): string | undefined {
  let h = host.toLowerCase();
  let p = stripSuffix(path).toLowerCase();
  if (!h || !p) return undefined;
  if (h === 'ssh.github.com') h = 'github.com';
  if (h === 'ssh.dev.azure.com' || h === 'vs-ssh.visualstudio.com') {
    h = 'dev.azure.com';
    p = p.replace(/^v3\//, '');
  } else if (h.endsWith('.visualstudio.com')) {
    p = `${h.slice(0, -'.visualstudio.com'.length)}/${p}`;
    h = 'dev.azure.com';
  }
  if (h === 'dev.azure.com') p = p.replace('/_git/', '/');
  return `${h}/${p}`;
}

/**
 * Reduces a Git remote URL to `host/owner/repo`, so HTTPS and SSH clones of one
 * repository match. Credentials in the URL are never kept. Local paths and unknown
 * transports give `undefined`, because they mean nothing on another machine.
 */
export function normalizeRemote(url: string): string | undefined {
  const value = url.trim();
  if (!value || value.length > 2048 || /\s/.test(value)) return undefined;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value)?.[1]?.toLowerCase();
  if (scheme) {
    if (!SCHEMES.has(scheme)) return undefined;
    try {
      const parsed = new URL(value.replace(/^[^:]+:/, 'https:'));
      return canonical(parsed.hostname, decodeURIComponent(parsed.pathname));
    } catch {
      return undefined;
    }
  }
  // `ext::sh -c ...` and friends are transport helpers, not locations.
  if (value.includes('::')) return undefined;
  const scp = SCP_LIKE.exec(value);
  // `C:\repo` looks like host "C", and a bare local path has no host.
  if (!scp?.[1] || !scp[2] || scp[1].length === 1) return undefined;
  return canonical(scp[1], scp[2]);
}

/** The short name to show for a normalized remote: `owner/repo`. */
export function remoteLabel(remote: string): string {
  const parts = remote.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : remote;
}

/** The repository part of a label, leaving local folder names unchanged. */
export function repoDisplayName(label: string): string {
  const withoutTrailingSlashes = label.replace(/\/+$/, '');
  return withoutTrailingSlashes.slice(withoutTrailingSlashes.lastIndexOf('/') + 1) || label;
}
