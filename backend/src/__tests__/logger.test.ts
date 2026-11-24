/**
 * Tests du logger structuré (US-RC-06) : niveaux LOG_LEVEL, format JSON (prod),
 * format lisible (dev), sérialisation sûre du contexte. Aucun appel au global console ici :
 * on espionne les flux process.stdout / process.stderr.
 */
import { ConsoleLogger } from '../services/logger/ConsoleLogger';
import { JsonLogger } from '../services/logger/JsonLogger';
import { configureLogger, createLogger, logger, resolveLogLevel, setLogger } from '../services/logger';

describe('logger structuré (US-RC-06)', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let originalNodeEnv: string | undefined;
  let originalLogLevel: string | undefined;
  let originalLogFormat: string | undefined;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    originalNodeEnv = process.env.NODE_ENV;
    originalLogLevel = process.env.LOG_LEVEL;
    originalLogFormat = process.env.LOG_FORMAT;
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalLogFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalLogFormat;
    configureLogger();
  });

  it('respecte LOG_LEVEL (niveau warn : debug/info filtrés, warn/error émis)', () => {
    const log = new ConsoleLogger('warn');
    log.debug(' invisible');
    log.info(' invisible');
    log.warn(' visible-warn');
    log.error(' visible-error', new Error('boom'));

    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toContain('visible-warn');
    expect(stderr).toContain('visible-error');
    expect(stderr).toContain('boom');
    expect(stderr).not.toContain('invisible');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('défaut : info en production, debug sinon (ne pas perdre de logs en prod)', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveLogLevel(process.env)).toBe('info');
    process.env.NODE_ENV = 'development';
    expect(resolveLogLevel(process.env)).toBe('debug');
    process.env.LOG_LEVEL = 'ERROR';
    expect(resolveLogLevel(process.env)).toBe('error');
    process.env.LOG_LEVEL = 'invalide';
    expect(resolveLogLevel(process.env)).toBe('debug');
  });

  it('JsonLogger (prod) écrit une ligne JSON structurée par log sur stdout', () => {
    process.env.NODE_ENV = 'production';
    const log = createLogger();
    expect(log).toBeInstanceOf(JsonLogger);

    log.info('run started', { runId: 'run-1', attempt: 2 });
    log.error('run failed', new Error('timeout'));
    log.debug('filtré en prod par défaut');

    const lines = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join('')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(first.level).toBe('info');
    expect(first.msg).toBe('run started');
    expect(first.meta).toEqual([{ runId: 'run-1', attempt: 2 }]);
    expect(typeof first.ts).toBe('string');
    const second = JSON.parse(lines[1]) as Record<string, unknown>;
    expect(second.level).toBe('error');
    const errMeta = (second.meta as Array<Record<string, unknown>>)[0];
    expect(errMeta.name).toBe('Error');
    expect(errMeta.message).toBe('timeout');
    expect(typeof errMeta.stack).toBe('string');
  });

  it('ConsoleLogger (dev) écrit du texte lisible, warn/error sur stderr', () => {
    process.env.NODE_ENV = 'development';
    const log = createLogger();
    expect(log).toBeInstanceOf(ConsoleLogger);

    log.debug('hello %s', 'world');
    log.warn('attention');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(String(stdoutSpy.mock.calls[0][0])).toBe('hello world\n');
    expect(String(stderrSpy.mock.calls[0][0])).toBe('attention\n');
  });

  it('sérialise les références circulaires sans planter', () => {
    const log = new JsonLogger('debug');
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    log.info('circular', circular);

    const line = JSON.parse(String(stdoutSpy.mock.calls[0][0]).trim()) as Record<string, unknown>;
    expect(line.meta).toEqual([{ a: 1, self: '[Circular]' }]);
  });

  it('le singleton logger délègue au logger configuré et reste espionnable', () => {
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    configureLogger({ ...process.env, NODE_ENV: 'development' });
    logger.error('via singleton', { code: 'X' });
    expect(spy).toHaveBeenCalledWith('via singleton', { code: 'X' });
    spy.mockRestore();
    setLogger(createLogger({ level: 'error', format: 'console' }, { ...process.env, NODE_ENV: 'development' }));
  });
});
