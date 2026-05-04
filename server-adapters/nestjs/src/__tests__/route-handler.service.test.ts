import { createDefaultTestContext } from '@internal/server-adapter-test-utils';
import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RouteHandlerService, ValidationError } from '../services/route-handler.service';

describe('RouteHandlerService', () => {
  it('validates empty object bodies when a body schema is present', async () => {
    const context = await createDefaultTestContext();
    const service = new RouteHandlerService(context.mastra, { mastra: context.mastra, prefix: '/api' });

    const route = {
      method: 'POST',
      path: '/test',
      responseType: 'json' as const,
      bodySchema: z.object({ name: z.string() }),
      handler: vi.fn(),
    };

    await expect(
      service.executeHandler(route, {
        pathParams: {},
        queryParams: {},
        body: {},
        requestContext: new RequestContext(),
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates empty string bodies when a body schema is present', async () => {
    const context = await createDefaultTestContext();
    const service = new RouteHandlerService(context.mastra, { mastra: context.mastra, prefix: '/api' });

    const route = {
      method: 'POST',
      path: '/test',
      responseType: 'json' as const,
      bodySchema: z.string().min(1),
      handler: vi.fn(),
    };

    await expect(
      service.executeHandler(route, {
        pathParams: {},
        queryParams: {},
        body: '',
        requestContext: new RequestContext(),
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // Regression tests for https://github.com/mastra-ai/mastra/issues/16114
  // NestJS adapter must NOT blindly coerce query values; schema-guided parsing
  // should only JSON-parse when the route schema expects a complex type.
  describe('query param coercion parity with Express/Hono/Koa/Fastify (fix #16114)', () => {
    it('preserves a string query param as a string when schema declares z.string()', async () => {
      const context = await createDefaultTestContext();
      const service = new RouteHandlerService(context.mastra, { mastra: context.mastra, prefix: '/api' });

      const captured: Record<string, unknown> = {};

      const route = {
        method: 'GET' as const,
        path: '/test',
        responseType: 'json' as const,
        queryParamSchema: z.object({
          filter: z.string().optional(),
        }),
        handler: vi.fn(async params => {
          Object.assign(captured, params);
          return {};
        }),
      };

      await service.executeHandler(route, {
        pathParams: {},
        queryParams: { filter: '{"a":1}' },
        body: undefined,
        requestContext: new RequestContext(),
        abortSignal: new AbortController().signal,
      });

      // The schema says filter is a string — it must NOT be JSON-parsed into an object.
      expect(captured['filter']).toBe('{"a":1}');
    });

    it('does not coerce "true" to boolean when schema declares z.string()', async () => {
      const context = await createDefaultTestContext();
      const service = new RouteHandlerService(context.mastra, { mastra: context.mastra, prefix: '/api' });

      const captured: Record<string, unknown> = {};

      const route = {
        method: 'GET' as const,
        path: '/test',
        responseType: 'json' as const,
        queryParamSchema: z.object({ enabled: z.string().optional() }),
        handler: vi.fn(async params => {
          Object.assign(captured, params);
          return {};
        }),
      };

      await service.executeHandler(route, {
        pathParams: {},
        queryParams: { enabled: 'true' },
        body: undefined,
        requestContext: new RequestContext(),
        abortSignal: new AbortController().signal,
      });

      expect(captured['enabled']).toBe('true');
      expect(typeof captured['enabled']).toBe('string');
    });

    it('does not coerce numeric-looking string when schema declares z.string()', async () => {
      const context = await createDefaultTestContext();
      const service = new RouteHandlerService(context.mastra, { mastra: context.mastra, prefix: '/api' });

      const captured: Record<string, unknown> = {};

      const route = {
        method: 'GET' as const,
        path: '/test',
        responseType: 'json' as const,
        queryParamSchema: z.object({ resourceId: z.string().optional() }),
        handler: vi.fn(async params => {
          Object.assign(captured, params);
          return {};
        }),
      };

      await service.executeHandler(route, {
        pathParams: {},
        queryParams: { resourceId: '42' },
        body: undefined,
        requestContext: new RequestContext(),
        abortSignal: new AbortController().signal,
      });

      expect(captured['resourceId']).toBe('42');
      expect(typeof captured['resourceId']).toBe('string');
    });

    it('JSON-parses a query param when schema declares z.object()', async () => {
      const context = await createDefaultTestContext();
      const service = new RouteHandlerService(context.mastra, { mastra: context.mastra, prefix: '/api' });

      const captured: Record<string, unknown> = {};

      const route = {
        method: 'GET' as const,
        path: '/test',
        responseType: 'json' as const,
        queryParamSchema: z.object({
          orderBy: z.object({ field: z.string(), direction: z.string() }).optional(),
        }),
        handler: vi.fn(async params => {
          Object.assign(captured, params);
          return {};
        }),
      };

      await service.executeHandler(route, {
        pathParams: {},
        queryParams: { orderBy: JSON.stringify({ field: 'name', direction: 'asc' }) },
        body: undefined,
        requestContext: new RequestContext(),
        abortSignal: new AbortController().signal,
      });

      // When schema expects an object, the JSON string should be parsed.
      expect(captured['orderBy']).toEqual({ field: 'name', direction: 'asc' });
    });
  });

  it('preserves context keys while stripping reserved request input keys', async () => {
    const context = await createDefaultTestContext();
    const service = new RouteHandlerService(context.mastra, {
      mastra: context.mastra,
      prefix: '/api',
      tools: { safeTool: { name: 'safeTool' } } as any,
      taskStore: {} as any,
    });

    const requestContext = new RequestContext();
    requestContext.set('user', { id: 'user-1' });
    const abortSignal = new AbortController().signal;

    const route = {
      method: 'POST',
      path: '/test',
      responseType: 'json' as const,
      handler: vi.fn(async params => params),
    };

    const result = await service.executeHandler(route, {
      pathParams: {
        id: '123',
        mastra: 'spoofed',
      },
      queryParams: {
        page: '2',
        abortSignal: 'spoofed',
      },
      body: {
        requestContext: 'spoofed',
        routePrefix: '/spoofed',
        custom: 'ok',
      },
      requestContext,
      abortSignal,
    });

    const handlerParams = await route.handler.mock.results[0]?.value;

    expect(result.responseType).toBe('json');
    expect(handlerParams.id).toBe('123');
    expect(handlerParams.page).toBe('2');
    expect(handlerParams.custom).toBe('ok');
    expect(handlerParams.mastra).toBe(context.mastra);
    expect(handlerParams.requestContext).toBe(requestContext);
    expect(handlerParams.abortSignal).toBe(abortSignal);
    expect(handlerParams.routePrefix).toBe('/api');
  });
});
