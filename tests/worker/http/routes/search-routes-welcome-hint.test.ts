import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { Request, Response } from 'express';
import { logger } from '../../../../src/utils/logger.js';

const generateContextStub = mock(async () => 'CONTEXT_FROM_GENERATOR');
mock.module('../../../../src/services/context-generator.js', () => ({
  generateContext: generateContextStub,
}));

let mockSettingsWanted = 'true';
mock.module('../../../../src/shared/paths.js', () => ({
  USER_SETTINGS_PATH: '/mock/settings.json',
  DB_PATH: ':memory:',
}));
mock.module('../../../../src/shared/SettingsDefaultsManager.js', () => ({
  SettingsDefaultsManager: {
    loadFromFile: () => ({
      CLAUDE_MEM_WELCOME_HINT_ENABLED: mockSettingsWanted,
      CLAUDE_MEM_WORKER_PORT: 37777,
      CLAUDE_MEM_FEED_MAX_ITEMS: '500',
      CLAUDE_MEM_QUEUE_MAX_MESSAGES: '10',
      CLAUDE_MEM_CHROMA_MCP_ENABLED: 'false',
    }),
  },
}));

import { SearchRoutes } from '../../../../src/services/worker/http/routes/SearchRoutes.js';

let loggerSpies: ReturnType<typeof spyOn>[] = [];

interface MockRes {
  setHeader: ReturnType<typeof mock>;
  send: ReturnType<typeof mock>;
  status: ReturnType<typeof mock>;
  json: ReturnType<typeof mock>;
  headersSent: boolean;
}

function createMockRes(): MockRes {
  const res: MockRes = {
    setHeader: mock(() => {}),
    send: mock(() => {}),
    status: mock(() => res as any),
    json: mock(() => {}),
    headersSent: false,
  };
  return res;
}

function captureContextInjectHandler(routes: SearchRoutes): (req: Request, res: Response) => void {
  let captured: ((req: Request, res: Response) => void) | undefined;
  const mockApp: any = {
    get: mock((path: string, handler: (req: Request, res: Response) => void) => {
      if (path === '/api/context/inject') {
        captured = handler;
      }
    }),
    post: mock(() => {}),
    delete: mock(() => {}),
    use: mock(() => {}),
  };
  routes.setupRoutes(mockApp);
  if (!captured) throw new Error('Failed to capture /api/context/inject handler');
  return captured;
}

// 前进时间让 getCachedSettings 的 5 秒缓存过期
function advanceTimePastCache() {
  const fakeNow = Date.now() + 6000;
  Date.now = () => fakeNow;
}

describe('SearchRoutes Welcome Hint', () => {
  let countQueryStub: ReturnType<typeof mock>;
  let prepareStub: ReturnType<typeof mock>;
  let mockSessionStore: any;
  let mockSearchManager: any;

  beforeEach(() => {
    mockSettingsWanted = 'true';
    generateContextStub.mockClear();
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
      spyOn(logger, 'failure').mockImplementation(() => {}),
    ];

    countQueryStub = mock(() => ({ count: 0 }));
    prepareStub = mock(() => ({ get: countQueryStub }));
    mockSessionStore = { db: { prepare: prepareStub } };
    mockSearchManager = {
      getSessionStore: () => mockSessionStore,
    };
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
  });

  it('returns the welcome hint when project has zero observations', async () => {
    const routes = new SearchRoutes(mockSearchManager);
    const handler = captureContextInjectHandler(routes);

    const res = createMockRes();
    const req = { query: { projects: '/path/to/empty-project' } } as unknown as Request;

    handler(req, res as unknown as Response);
    await new Promise(resolve => setImmediate(resolve));

    expect(res.send).toHaveBeenCalledTimes(1);
    const body = (res.send as any).mock.calls[0][0] as string;
    expect(body).toContain('# claude-mem-plus status');
    expect(body).toContain('/learn-codebase');
    expect(body).toContain('http://localhost:');
    expect(body).toContain('Memory injection starts on your second session in a project.');
    expect(body).toContain('disappears once the first observation lands');
    expect(body).not.toContain('Welcome');
    expect(generateContextStub).not.toHaveBeenCalled();
  });

  it('skips the welcome hint when at least one observation exists', async () => {
    countQueryStub = mock(() => ({ count: 7 }));
    prepareStub = mock(() => ({ get: countQueryStub }));
    mockSessionStore = { db: { prepare: prepareStub } };
    mockSearchManager = { getSessionStore: () => mockSessionStore };

    const routes = new SearchRoutes(mockSearchManager);
    const handler = captureContextInjectHandler(routes);

    const res = createMockRes();
    const req = { query: { projects: '/path/to/active-project' } } as unknown as Request;

    handler(req, res as unknown as Response);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(generateContextStub).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith('CONTEXT_FROM_GENERATOR');
  });

  it('skips the welcome hint when CLAUDE_MEM_WELCOME_HINT_ENABLED=false', async () => {
    mockSettingsWanted = 'false';
    // 前进时间让 getCachedSettings 的 5 秒 TTL 缓存过期
    advanceTimePastCache();

    const routes = new SearchRoutes(mockSearchManager);
    const handler = captureContextInjectHandler(routes);

    const res = createMockRes();
    const req = { query: { projects: '/path/to/empty-project' } } as unknown as Request;

    handler(req, res as unknown as Response);
    await new Promise(r => setTimeout(r, 200));

    expect(generateContextStub).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith('CONTEXT_FROM_GENERATOR');
  });

  it('queries both projects in a worktree (multi-project) request', async () => {
    advanceTimePastCache();

    const routes = new SearchRoutes(mockSearchManager);
    const handler = captureContextInjectHandler(routes);

    const res = createMockRes();
    const req = { query: { projects: '/path/parent, /path/worktree' } } as unknown as Request;

    handler(req, res as unknown as Response);
    await new Promise(resolve => setImmediate(resolve));

    expect(res.send).toHaveBeenCalledTimes(1);
    expect(countQueryStub).toHaveBeenCalledWith(
      '/path/parent',
      '/path/worktree',
      '/path/parent',
      '/path/worktree',
    );
  });
});