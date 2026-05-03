import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  expandUserPath,
  extractFilesFromReadMany,
  extractLiteralFromRegex,
  extractPattern,
  findGitNexusRoot,
  normalizePathArg,
  resolveGitNexusCmd,
  validateRepoRelativePath,
} from '../src/gitnexus';

describe('gitnexus helpers', () => {
  it('prefers saved config over the empty default flag value', () => {
    expect(resolveGitNexusCmd('', 'npx gitnexus@latest')).toEqual(['npx', 'gitnexus@latest']);
    expect(resolveGitNexusCmd(undefined, 'npx gitnexus@latest')).toEqual(['npx', 'gitnexus@latest']);
    expect(resolveGitNexusCmd('gitnexus --debug', 'npx gitnexus@latest')).toEqual(['gitnexus', '--debug']);
  });

  it('finds the nearest gitnexus repo root even from deep nested directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-gitnexus-root-'));
    const nested = join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    mkdirSync(join(root, '.gitnexus'));
    mkdirSync(nested, { recursive: true });

    try {
      expect(findGitNexusRoot(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('augments markdown reads and read_many batches', () => {
    expect(extractPattern('read', { path: '/repo/README.md' })).toBe('README');
    expect(
      extractFilesFromReadMany(
        {
          files: [
            { path: '/repo/docs/ARCHITECTURE.md' },
            { path: '/repo/src/index.ts' },
          ],
        },
        [],
      ),
    ).toEqual([
      { path: '/repo/docs/ARCHITECTURE.md', pattern: 'ARCHITECTURE' },
      { path: '/repo/src/index.ts', pattern: 'index' },
    ]);
  });

  it('normalizes path args with a leading @ prefix', () => {
    expect(normalizePathArg('@src/auth.ts')).toBe('src/auth.ts');
    expect(normalizePathArg('src/auth.ts')).toBe('src/auth.ts');
  });

  it('expands ~/ repo paths before filesystem resolution', () => {
    expect(expandUserPath('~/demo')).toBe(join(homedir(), 'demo'));
    expect(expandUserPath('/tmp/demo')).toBe('/tmp/demo');
  });

  it('rejects invalid repo-relative paths', () => {
    expect(validateRepoRelativePath('src/auth.ts')).toBe('src/auth.ts');
    expect(validateRepoRelativePath('../etc/passwd')).toBeNull();
    expect(validateRepoRelativePath('/etc/passwd')).toBeNull();
    expect(validateRepoRelativePath('')).toBeNull();
  });
});

describe('extractLiteralFromRegex', () => {
  it('returns plain identifiers unchanged', () => {
    expect(extractLiteralFromRegex('validateUser')).toBe('validateUser');
    expect(extractLiteralFromRegex('foo_bar')).toBe('foo_bar');
  });

  it('extracts longest literal from regex with metacharacters', () => {
    // Foo, Bar, Baz are all 3 chars — Foo is found first
    expect(extractLiteralFromRegex('(Foo|Bar)Baz')).toBe('Foo');
    expect(extractLiteralFromRegex('foo\\.bar')).toBe('foo');
    expect(extractLiteralFromRegex('^export\\s+function\\s+(\\w+)')).toBe('function');
  });

  it('handles alternation — picks longest branch', () => {
    expect(extractLiteralFromRegex('(validateUser|check)')).toBe('validateUser');
  });

  it('returns null for patterns with no valid identifier', () => {
    expect(extractLiteralFromRegex('.*')).toBeNull();
    expect(extractLiteralFromRegex('^$')).toBeNull();
    expect(extractLiteralFromRegex('ab')).toBeNull(); // too short
  });

  it('strips surrounding quotes', () => {
    expect(extractLiteralFromRegex('"validateUser"')).toBe('validateUser');
    expect(extractLiteralFromRegex("'authenticate'")).toBe('authenticate');
  });
});

describe('extractPattern — grep', () => {
  it('extracts literal from simple pattern', () => {
    expect(extractPattern('grep', { pattern: 'validateUser' })).toBe('validateUser');
  });

  it('extracts literal from regex pattern', () => {
    expect(extractPattern('grep', { pattern: '(Foo|Bar)' })).toBe('Foo');
    expect(extractPattern('grep', { pattern: 'foo\\.bar' })).toBe('foo');
  });

  it('returns null for pure metacharacter patterns', () => {
    expect(extractPattern('grep', { pattern: '.*' })).toBeNull();
  });
});

describe('extractPattern — bash with quotes and pipes', () => {
  it('extracts pattern from quoted grep args', () => {
    expect(extractPattern('bash', { command: 'grep "validateUser" src/' })).toBe('validateUser');
    expect(extractPattern('bash', { command: "grep 'authenticate' src/" })).toBe('authenticate');
  });

  it('handles piped commands — only parses the grep segment', () => {
    expect(extractPattern('bash', { command: 'grep validateUser src/ | head -5' })).toBe('validateUser');
    expect(extractPattern('bash', { command: 'cat file.txt | grep validateUser' })).toBe('validateUser');
  });

  it('handles && chained commands', () => {
    expect(extractPattern('bash', { command: 'cd src && grep validateUser *.ts' })).toBe('validateUser');
  });

  it('extracts file basename from cat with quoted path', () => {
    expect(extractPattern('bash', { command: 'cat "src/validator.ts"' })).toBe('validator');
  });
});

describe('extractPattern — read', () => {
  it('extracts basename from code files', () => {
    expect(extractPattern('read', { path: '/repo/src/validator.ts' })).toBe('validator');
    expect(extractPattern('read', { path: '/repo/src/authenticate.py' })).toBe('authenticate');
    expect(extractPattern('read', { path: '/repo/README.md' })).toBe('README');
    expect(extractPattern('read', { path: '/repo/src/index.ts' })).toBe('index');
  });

  it('skips non-code files', () => {
    expect(extractPattern('read', { path: '/repo/data.json' })).toBeNull();
    expect(extractPattern('read', { path: '/repo/image.png' })).toBeNull();
  });

  it('skips basenames shorter than 3 chars', () => {
    expect(extractPattern('read', { path: '/repo/src/ab.ts' })).toBeNull();
  });
});

describe('extractFilePatternsFromContent', () => {
  it('extracts file patterns from grep output lines', async () => {
    const { extractFilePatternsFromContent } = await import('../src/gitnexus');
    expect(
      extractFilePatternsFromContent(
        [{ type: 'text', text: 'src/auth.ts:10:match\nsrc/utils.ts:5:other' }],
        2,
      ),
    ).toEqual(['auth', 'utils']);
  });

  it('respects limit parameter', async () => {
    const { extractFilePatternsFromContent } = await import('../src/gitnexus');
    expect(
      extractFilePatternsFromContent(
        [{ type: 'text', text: 'src/auth.ts:1:x\nsrc/utils.ts:2:y\nsrc/config.ts:3:z' }],
        1,
      ),
    ).toEqual(['auth']);
  });

  it('skips non-matching lines', async () => {
    const { extractFilePatternsFromContent } = await import('../src/gitnexus');
    expect(
      extractFilePatternsFromContent(
        [{ type: 'text', text: 'no file pattern here\njust text' }],
        2,
      ),
    ).toEqual([]);
  });
});

describe('safeResolvePath', () => {
  it('resolves paths within cwd', async () => {
    const { safeResolvePath } = await import('../src/gitnexus');
    expect(safeResolvePath('src/auth.ts', '/repo')).toBe('/repo/src/auth.ts');
  });

  it('rejects path traversal', async () => {
    const { safeResolvePath } = await import('../src/gitnexus');
    expect(safeResolvePath('../etc/passwd', '/repo')).toBeNull();
  });
});

describe('toRepoRelativePath', () => {
  it('computes relative path within repo', async () => {
    const { toRepoRelativePath } = await import('../src/gitnexus');
    expect(toRepoRelativePath('/repo/src/auth.ts', '/repo')).toBe('src/auth.ts');
  });

  it('returns null for paths outside repo', async () => {
    const { toRepoRelativePath } = await import('../src/gitnexus');
    expect(toRepoRelativePath('/etc/passwd', '/repo')).toBeNull();
  });
});

describe('validateMcpMode', () => {
  it('validates mode strings', async () => {
    const { validateMcpMode } = await import('../src/gitnexus');
    expect(validateMcpMode('local')).toBe('local');
    expect(validateMcpMode('remote')).toBe('remote');
    expect(validateMcpMode('auto')).toBe('auto');
    expect(validateMcpMode('invalid')).toBe('auto');
    expect(validateMcpMode(null)).toBe('auto');
    expect(validateMcpMode(undefined)).toBe('auto');
  });
});
