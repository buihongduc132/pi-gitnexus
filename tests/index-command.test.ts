import { beforeEach, describe, expect, it, vi } from 'vitest';

const callToolMock = vi.fn();
const sendUserMessageMock = vi.fn();
const notifyMock = vi.fn();
const registerCommandMock = vi.fn();
const registerToolMock = vi.fn();
const registerFlagMock = vi.fn();
const onMock = vi.fn();
const getFlagMock = vi.fn(() => '');

vi.mock('../src/mcp-client', () => ({
  mcpClient: {
    callTool: callToolMock,
    stop: vi.fn(),
  },
}));

vi.mock('../src/tools', () => ({
  registerTools: vi.fn(),
}));

vi.mock('../src/gitnexus', async () => {
  const actual = await vi.importActual<typeof import('../src/gitnexus')>('../src/gitnexus');
  return {
    ...actual,
    findGitNexusRoot: vi.fn(() => '/repo-root'),
    findGitNexusIndex: vi.fn(() => true),
    loadSavedConfig: vi.fn(() => ({})),
    runAugment: vi.fn(async () => null),
    resolveGitNexusCmd: vi.fn(() => ['gitnexus']),
    updateSpawnEnv: vi.fn(),
    setGitnexusCmd: vi.fn(),
    clearIndexCache: vi.fn(),
  };
});

describe('/gitnexus command error handling', () => {
  beforeEach(() => {
    callToolMock.mockReset();
    sendUserMessageMock.mockReset();
    notifyMock.mockReset();
    registerCommandMock.mockReset();
  });

  it('catches MCP errors in slash commands and notifies the user', async () => {
    callToolMock.mockRejectedValue(new Error('[GitNexus] repo selection failed'));

    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('query auth', { cwd: '/outside/repo', ui: { notify: notifyMock } });

    expect(notifyMock).toHaveBeenCalledWith('[GitNexus] repo selection failed', 'error');
    expect(sendUserMessageMock).not.toHaveBeenCalled();
  });

  it('/gitnexus on enables auto-augment', async () => {
    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('on', { cwd: '/repo-root', ui: { notify: notifyMock } });

    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('enabled'), 'info');
  });

  it('/gitnexus off disables auto-augment', async () => {
    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('off', { cwd: '/repo-root', ui: { notify: notifyMock } });

    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'info');
  });

  it('/gitnexus help shows usage information', async () => {
    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('help', { cwd: '/repo-root', ui: { notify: notifyMock } });

    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('Commands:'), 'info');
  });

  it('/gitnexus context requires a name argument', async () => {
    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('context', { cwd: '/repo-root', ui: { notify: notifyMock } });

    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('Usage'), 'info');
  });

  it('/gitnexus <pattern> does manual augment lookup', async () => {
    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('somePattern', { cwd: '/repo-root', ui: { notify: notifyMock } });

    // runAugment is mocked to return null, so should notify 'No graph context found'
    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('No graph context'), 'info');
  });

  it('/gitnexus <short> rejects patterns shorter than 3 chars', async () => {
    const { default: register } = await import('../src/index');
    register({
      registerTool: registerToolMock,
      registerCommand: registerCommandMock,
      registerFlag: registerFlagMock,
      on: onMock,
      getFlag: getFlagMock,
      sendUserMessage: sendUserMessageMock,
    } as any);

    const command = registerCommandMock.mock.calls[0][1];
    await command.handler('ab', { cwd: '/repo-root', ui: { notify: notifyMock } });

    expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('too short'), 'info');
  });
});
