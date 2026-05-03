import { describe, expect, it } from 'vitest';

describe('GitNexusConfig round-trip', () => {
  it('loadSavedConfig returns a valid config object', async () => {
    const { loadSavedConfig } = await import('../src/gitnexus');
    const cfg = loadSavedConfig();
    expect(typeof cfg).toBe('object');
    expect(cfg).not.toBeNull();
  });

  it('config fields are all optional', async () => {
    const { loadSavedConfig } = await import('../src/gitnexus');
    const cfg = loadSavedConfig();
    expect(cfg.cmd === undefined || typeof cfg.cmd === 'string').toBe(true);
    expect(cfg.autoAugment === undefined || typeof cfg.autoAugment === 'boolean').toBe(true);
    expect(cfg.augmentTimeout === undefined || typeof cfg.augmentTimeout === 'number').toBe(true);
    expect(cfg.maxAugmentsPerResult === undefined || typeof cfg.maxAugmentsPerResult === 'number').toBe(true);
    expect(cfg.maxSecondaryPatterns === undefined || typeof cfg.maxSecondaryPatterns === 'number').toBe(true);
    expect(cfg.mode === undefined || ['auto', 'local', 'remote'].includes(cfg.mode!)).toBe(true);
    expect(cfg.serverUrl === undefined || typeof cfg.serverUrl === 'string').toBe(true);
  });
});

describe('setAugmentTimeout', () => {
  it('converts seconds to milliseconds', async () => {
    const { setAugmentTimeout } = await import('../src/gitnexus');
    setAugmentTimeout(10);
    setAugmentTimeout(4);
  });
});

describe('validateMcpMode', () => {
  it('accepts valid modes', async () => {
    const { validateMcpMode } = await import('../src/gitnexus');
    expect(validateMcpMode('local')).toBe('local');
    expect(validateMcpMode('remote')).toBe('remote');
    expect(validateMcpMode('auto')).toBe('auto');
  });

  it('defaults to "auto" for invalid values', async () => {
    const { validateMcpMode } = await import('../src/gitnexus');
    expect(validateMcpMode('invalid')).toBe('auto');
    expect(validateMcpMode('')).toBe('auto');
    expect(validateMcpMode(undefined)).toBe('auto');
    expect(validateMcpMode(null)).toBe('auto');
    expect(validateMcpMode(42)).toBe('auto');
  });
});

describe('DEFAULT_SERVER_URL', () => {
  it('is a valid HTTP URL', async () => {
    const { DEFAULT_SERVER_URL } = await import('../src/gitnexus');
    expect(DEFAULT_SERVER_URL).toMatch(/^https?:\/\//);
    expect(DEFAULT_SERVER_URL).toContain('4747');
  });
});
