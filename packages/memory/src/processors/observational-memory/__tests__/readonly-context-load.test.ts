/**
 * Tests that ObservationalMemoryProcessor in read-only mode still loads
 * existing context (history + system message) into the MessageList.
 *
 * Bug: the previous read-only fast path returned messageList immediately
 * without calling memory.getContext(), so stored history was never loaded.
 * Agents running with readOnly:true would always start with an empty context.
 *
 * Fix: in read-only mode (stepNumber === 0), call memory.getContext() and
 * hydrate the MessageList with stored messages and system message, then return
 * without creating any turn or triggering any write/observation side effects.
 *
 * Ref: https://github.com/mastra-ai/mastra/issues/16037
 */
import type { MastraDBMessage } from '@mastra/core/agent';
import { InMemoryMemory, InMemoryDB } from '@mastra/core/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ObservationalMemory } from '../observational-memory';
import { ObservationalMemoryProcessor } from '../processor';
import type { MemoryContextProvider } from '../processor';

function createInMemoryStorage(): InMemoryMemory {
  const db = new InMemoryDB();
  return new InMemoryMemory({ db });
}

function makeMsg(id: string, role: 'user' | 'assistant', text: string, threadId: string, resourceId: string): MastraDBMessage {
  return {
    id,
    role,
    content: { format: 2, parts: [{ type: 'text', text }] },
    type: 'text',
    createdAt: new Date(),
    threadId,
    resourceId,
  };
}

function createStubMemoryProvider(overrides?: Partial<{
  messages: MastraDBMessage[];
  systemMessage: string | undefined;
}>): MemoryContextProvider & { getContext: ReturnType<typeof vi.fn> } {
  const getContext = vi.fn().mockResolvedValue({
    systemMessage: overrides?.systemMessage,
    messages: overrides?.messages ?? [],
    hasObservations: false,
    omRecord: null,
    continuationMessage: undefined,
    otherThreadsContext: undefined,
  });
  return {
    getContext,
    persistMessages: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ObservationalMemoryProcessor — read-only context load', () => {
  const threadId = 'readonly-thread';
  const resourceId = 'readonly-resource';

  let om: ObservationalMemory;

  beforeEach(() => {
    const storage = createInMemoryStorage();
    om = new ObservationalMemory({
      storage,
      observation: { messageTokens: 100_000, model: 'test-model' },
      reflection: { observationTokens: 100_000, model: 'test-model' },
      scope: 'thread',
    });
  });

  it('loads stored history into messageList when readOnly is true (stepNumber 0)', async () => {
    const { MessageList } = await import('@mastra/core/agent');
    const { RequestContext } = await import('@mastra/core/di');

    const storedHistory: MastraDBMessage[] = [
      makeMsg('h1', 'user', 'What is Mastra?', threadId, resourceId),
      makeMsg('h2', 'assistant', 'Mastra is a TypeScript AI framework.', threadId, resourceId),
    ];

    const memoryProvider = createStubMemoryProvider({ messages: storedHistory });
    const processor = new ObservationalMemoryProcessor(om, memoryProvider);

    const requestContext = new RequestContext();
    requestContext.set('MastraMemory', { thread: { id: threadId }, resourceId, memoryConfig: { readOnly: true } });

    const messageList = new MessageList({ threadId, resourceId });
    const newUserMsg = makeMsg('new-1', 'user', 'Tell me more', threadId, resourceId);

    await processor.processInputStep({
      messageList,
      messages: [newUserMsg],
      requestContext,
      stepNumber: 0,
      state: {},
      steps: [],
      systemMessages: [],
      model: 'test-model' as any,
      retryCount: 0,
      abort: (() => { throw new Error('aborted'); }) as any,
    });

    // memory.getContext must have been called — history is loaded
    expect(memoryProvider.getContext).toHaveBeenCalledWith({ threadId, resourceId });

    // The stored messages should now be in the messageList
    const allMsgs = messageList.get.all.db();
    const storedIds = storedHistory.map(m => m.id);
    const loadedIds = allMsgs.map(m => m.id);
    for (const id of storedIds) {
      expect(loadedIds).toContain(id);
    }
  });

  it('does NOT call memory.getContext on subsequent steps in read-only mode', async () => {
    const { MessageList } = await import('@mastra/core/agent');
    const { RequestContext } = await import('@mastra/core/di');

    const memoryProvider = createStubMemoryProvider({
      messages: [makeMsg('h1', 'user', 'Hello', threadId, resourceId)],
    });
    const processor = new ObservationalMemoryProcessor(om, memoryProvider);

    const requestContext = new RequestContext();
    requestContext.set('MastraMemory', { thread: { id: threadId }, resourceId, memoryConfig: { readOnly: true } });

    const messageList = new MessageList({ threadId, resourceId });
    const state: Record<string, unknown> = {};

    // Step 0 — should call getContext
    await processor.processInputStep({
      messageList,
      messages: [],
      requestContext,
      stepNumber: 0,
      state,
      steps: [],
      systemMessages: [],
      model: 'test-model' as any,
      retryCount: 0,
      abort: (() => { throw new Error('aborted'); }) as any,
    });

    // Step 1 — should NOT call getContext again (would re-add duplicate history)
    await processor.processInputStep({
      messageList,
      messages: [],
      requestContext,
      stepNumber: 1,
      state,
      steps: [],
      systemMessages: [],
      model: 'test-model' as any,
      retryCount: 0,
      abort: (() => { throw new Error('aborted'); }) as any,
    });

    // getContext was called exactly once (for step 0 only)
    expect(memoryProvider.getContext).toHaveBeenCalledTimes(1);
  });

  it('does not create a turn or persist messages in read-only mode', async () => {
    const { MessageList } = await import('@mastra/core/agent');
    const { RequestContext } = await import('@mastra/core/di');

    const memoryProvider = createStubMemoryProvider();
    const processor = new ObservationalMemoryProcessor(om, memoryProvider);

    const requestContext = new RequestContext();
    requestContext.set('MastraMemory', { thread: { id: threadId }, resourceId, memoryConfig: { readOnly: true } });

    const messageList = new MessageList({ threadId, resourceId });

    const beginTurnSpy = vi.spyOn(om, 'beginTurn');

    await processor.processInputStep({
      messageList,
      messages: [],
      requestContext,
      stepNumber: 0,
      state: {},
      steps: [],
      systemMessages: [],
      model: 'test-model' as any,
      retryCount: 0,
      abort: (() => { throw new Error('aborted'); }) as any,
    });

    // No observation turn should be created in read-only mode
    expect(beginTurnSpy).not.toHaveBeenCalled();
    // persistMessages should not have been called
    expect(memoryProvider.persistMessages).not.toHaveBeenCalled();
  });

  it('loads system message into messageList when provided in read-only mode', async () => {
    const { MessageList } = await import('@mastra/core/agent');
    const { RequestContext } = await import('@mastra/core/di');

    const systemMsg = 'You are a helpful assistant with read-only memory.';
    const memoryProvider = createStubMemoryProvider({
      messages: [],
      systemMessage: systemMsg,
    });
    const processor = new ObservationalMemoryProcessor(om, memoryProvider);

    const requestContext = new RequestContext();
    requestContext.set('MastraMemory', { thread: { id: threadId }, resourceId, memoryConfig: { readOnly: true } });

    const messageList = new MessageList({ threadId, resourceId });

    await processor.processInputStep({
      messageList,
      messages: [],
      requestContext,
      stepNumber: 0,
      state: {},
      steps: [],
      systemMessages: [],
      model: 'test-model' as any,
      retryCount: 0,
      abort: (() => { throw new Error('aborted'); }) as any,
    });

    // System message should have been added to messageList
    const serialized = messageList.serialize();
    const hasSysMsg = (serialized.messages ?? []).some(
      (m: any) => m.role === 'system' && (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).includes('read-only memory'),
    );
    expect(hasSysMsg).toBe(true);
  });
});
