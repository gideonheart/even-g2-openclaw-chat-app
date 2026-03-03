// ── Tests for VoiceLoopController — gateway-to-bus event bridging ──
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from '../events';
import type { AppEventMap, AppSettings, VoiceTurnChunk, ConnectionStatus } from '../types';
import { createVoiceLoopController } from '../voice-loop-controller';

/** Create a blob large enough to pass the empty-audio guard (> MIN_AUDIO_BYTES + 44). */
function makeAudioBlob(label = 'audio'): Blob {
  // 2000 bytes exceeds MIN_AUDIO_BYTES (1600) + 44 WAV header threshold
  const buf = new ArrayBuffer(2000);
  // Write the label into the first bytes for debuggability
  const view = new Uint8Array(buf);
  for (let i = 0; i < label.length && i < view.length; i++) {
    view[i] = label.charCodeAt(i);
  }
  return new Blob([buf]);
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    gatewayUrl: 'http://localhost:8000',
    sessionKey: 'test-key',
    sttProvider: 'whisperx',
    apiKey: 'ak-test',
    ...overrides,
  };
}

function createMockGateway() {
  let chunkCb: ((chunk: VoiceTurnChunk) => void) | null = null;
  let statusCb: ((status: ConnectionStatus) => void) | null = null;

  return {
    onChunk: vi.fn((cb: (chunk: VoiceTurnChunk) => void) => {
      chunkCb = cb;
      return () => { chunkCb = null; };
    }),
    onStatusChange: vi.fn((cb: (status: ConnectionStatus) => void) => {
      statusCb = cb;
      return () => { statusCb = null; };
    }),
    sendVoiceTurn: vi.fn(),
    sendTextTurn: vi.fn(),
    // Test helpers
    simulateChunk(chunk: VoiceTurnChunk) { chunkCb?.(chunk); },
    simulateStatus(status: ConnectionStatus) { statusCb?.(status); },
    // Unused but required by GatewayClient type
    checkHealth: vi.fn(),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    abort: vi.fn(),
    destroy: vi.fn(),
    getHealth: vi.fn(),
  };
}

describe('VoiceLoopController', () => {
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let gateway: ReturnType<typeof createMockGateway>;
  let settings: AppSettings;

  beforeEach(() => {
    bus = createEventBus<AppEventMap>();
    gateway = createMockGateway();
    settings = makeSettings();
  });

  it('forwards gateway chunks to bus', () => {
    createVoiceLoopController({ bus, gateway, settings: () => settings });

    const handler = vi.fn();
    bus.on('gateway:chunk', handler);

    const chunk: VoiceTurnChunk = { type: 'response_delta', text: 'Hello' };
    gateway.simulateChunk(chunk);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(chunk);
  });

  it('forwards gateway status changes to bus', () => {
    createVoiceLoopController({ bus, gateway, settings: () => settings });

    const handler = vi.fn();
    bus.on('gateway:status', handler);

    gateway.simulateStatus('connected');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ status: 'connected' });
  });

  it('sends voice turn on recording stop', () => {
    createVoiceLoopController({ bus, gateway, settings: () => settings });

    const blob = makeAudioBlob('audio-data');
    bus.emit('audio:recording-stop', { sessionId: 'gideon', blob });

    expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();
    expect(gateway.sendVoiceTurn).toHaveBeenCalledWith(
      settings,
      { sessionId: 'gideon', audio: blob, sttProvider: 'whisperx' },
    );
  });

  it('uses settings getter for current values', () => {
    let currentSettings = makeSettings({ sttProvider: 'whisperx' });
    createVoiceLoopController({
      bus,
      gateway,
      settings: () => currentSettings,
    });

    const blob1 = makeAudioBlob('audio1');
    bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });

    expect(gateway.sendVoiceTurn.mock.calls[0][1].sttProvider).toBe('whisperx');

    // Change settings between recording-stop events
    currentSettings = makeSettings({ sttProvider: 'openai' });

    const blob2 = makeAudioBlob('audio2');
    bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });

    // Second turn is queued (not sent yet) -- drain queue via response_end
    gateway.simulateChunk({ type: 'response_end' });

    expect(gateway.sendVoiceTurn.mock.calls[1][1].sttProvider).toBe('openai');
  });

  it('destroy unsubscribes all listeners', () => {
    const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

    const chunkHandler = vi.fn();
    const statusHandler = vi.fn();
    bus.on('gateway:chunk', chunkHandler);
    bus.on('gateway:status', statusHandler);

    controller.destroy();

    // Gateway callbacks should be unsubscribed
    gateway.simulateChunk({ type: 'response_delta', text: 'Hello' });
    gateway.simulateStatus('connected');
    expect(chunkHandler).not.toHaveBeenCalled();
    expect(statusHandler).not.toHaveBeenCalled();

    // Bus subscription should be unsubscribed
    bus.emit('audio:recording-stop', { sessionId: 'gideon', blob: new Blob() });
    expect(gateway.sendVoiceTurn).not.toHaveBeenCalled();
  });

  it('handles multiple chunks in sequence', () => {
    createVoiceLoopController({ bus, gateway, settings: () => settings });

    const handler = vi.fn();
    bus.on('gateway:chunk', handler);

    gateway.simulateChunk({ type: 'response_start' });
    gateway.simulateChunk({ type: 'response_delta', text: 'Hi' });
    gateway.simulateChunk({ type: 'response_end' });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0][0].type).toBe('response_start');
    expect(handler.mock.calls[1][0].type).toBe('response_delta');
    expect(handler.mock.calls[2][0].type).toBe('response_end');
  });

  describe('empty-audio guard', () => {
    it('skips empty audio blob (44 bytes = WAV header only)', () => {
      createVoiceLoopController({ bus, gateway, settings: () => settings });

      const logSpy = vi.fn();
      bus.on('log', logSpy);

      // 44-byte blob = WAV header only, zero audio data
      const emptyBlob = new Blob([new ArrayBuffer(44)]);
      bus.emit('audio:recording-stop', { sessionId: 'empty', blob: emptyBlob });

      expect(gateway.sendVoiceTurn).not.toHaveBeenCalled();

      const warnCalls = logSpy.mock.calls.filter(
        (args) => args[0].level === 'warn' && args[0].msg.includes('Empty audio blob'),
      );
      expect(warnCalls.length).toBe(1);
    });

    it('warns on very short audio but still sends', () => {
      createVoiceLoopController({ bus, gateway, settings: () => settings });

      const logSpy = vi.fn();
      bus.on('log', logSpy);

      // 50 bytes = 44 header + 6 bytes PCM (under MIN_AUDIO_BYTES threshold)
      const shortBlob = new Blob([new ArrayBuffer(50)]);
      bus.emit('audio:recording-stop', { sessionId: 'short', blob: shortBlob });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();

      const warnCalls = logSpy.mock.calls.filter(
        (args) => args[0].level === 'warn' && args[0].msg.includes('Very short audio'),
      );
      expect(warnCalls.length).toBe(1);
    });

    it('normal audio blob proceeds without warning', () => {
      createVoiceLoopController({ bus, gateway, settings: () => settings });

      const logSpy = vi.fn();
      bus.on('log', logSpy);

      // 5000 bytes = well above MIN_AUDIO_BYTES + 44
      const normalBlob = new Blob([new ArrayBuffer(5000)]);
      bus.emit('audio:recording-stop', { sessionId: 'normal', blob: normalBlob });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();

      const audioWarnCalls = logSpy.mock.calls.filter(
        (args) =>
          args[0].level === 'warn' &&
          (args[0].msg.includes('Empty audio blob') || args[0].msg.includes('Very short audio')),
      );
      expect(audioWarnCalls.length).toBe(0);
    });
  });

  describe('voice turn queue', () => {
    it('queues second voice turn while first is in-flight', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      const blob1 = makeAudioBlob('audio1');
      const blob2 = makeAudioBlob('audio2');
      bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });

      // Only first turn should have been sent
      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();
      expect(gateway.sendVoiceTurn.mock.calls[0][1].sessionId).toBe('s1');
      expect(controller.getQueueLength()).toBe(1);
    });

    it('drains queued turn after response_end', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      const blob1 = makeAudioBlob('audio1');
      const blob2 = makeAudioBlob('audio2');
      bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();

      // Complete first turn
      gateway.simulateChunk({ type: 'response_end' });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(2);
      expect(gateway.sendVoiceTurn.mock.calls[1][1].sessionId).toBe('s2');
      expect(controller.getQueueLength()).toBe(0);
    });

    it('drains queued turn after error chunk', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      const blob1 = makeAudioBlob('audio1');
      const blob2 = makeAudioBlob('audio2');
      bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });

      // Error on first turn should still drain queue (no deadlock)
      gateway.simulateChunk({ type: 'error', error: 'timeout' });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(2);
      expect(gateway.sendVoiceTurn.mock.calls[1][1].sessionId).toBe('s2');
      expect(controller.getQueueLength()).toBe(0);
    });

    it('processes three turns sequentially', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      bus.emit('audio:recording-stop', { sessionId: 's1', blob: makeAudioBlob('a1') });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: makeAudioBlob('a2') });
      bus.emit('audio:recording-stop', { sessionId: 's3', blob: makeAudioBlob('a3') });

      // Only first fires immediately
      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();

      gateway.simulateChunk({ type: 'response_end' });
      expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(2);
      expect(gateway.sendVoiceTurn.mock.calls[1][1].sessionId).toBe('s2');

      gateway.simulateChunk({ type: 'response_end' });
      expect(gateway.sendVoiceTurn).toHaveBeenCalledTimes(3);
      expect(gateway.sendVoiceTurn.mock.calls[2][1].sessionId).toBe('s3');

      expect(controller.getQueueLength()).toBe(0);
    });

    it('destroy clears pending queue and prevents drain', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      bus.emit('audio:recording-stop', { sessionId: 's1', blob: makeAudioBlob('a1') });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: makeAudioBlob('a2') });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();

      controller.destroy();

      // Stale response_end after destroy should NOT drain queue
      gateway.simulateChunk({ type: 'response_end' });

      // Still only the initial immediate send
      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();
      expect(controller.getQueueLength()).toBe(0);
    });

    it('drops oldest turn when queue is full (MAX_QUEUE=5)', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      // First turn fires immediately (busy=true)
      bus.emit('audio:recording-stop', { sessionId: 'first', blob: makeAudioBlob('first') });
      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();

      // Emit 6 more turns (exceeds MAX_QUEUE of 5)
      for (let i = 1; i <= 6; i++) {
        bus.emit('audio:recording-stop', { sessionId: `q${i}`, blob: makeAudioBlob(`q${i}`) });
      }

      // Still only the first turn sent
      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();
      // Queue should be capped at 5 (q1 was dropped, q2-q6 remain)
      expect(controller.getQueueLength()).toBe(5);

      // Drain all 5 and verify the oldest (q1) was dropped
      const drainedSessionIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        gateway.simulateChunk({ type: 'response_end' });
        const lastCall = gateway.sendVoiceTurn.mock.calls[gateway.sendVoiceTurn.mock.calls.length - 1];
        drainedSessionIds.push(lastCall[1].sessionId);
      }

      // q1 should have been dropped; drained order should be q2, q3, q4, q5, q6
      expect(drainedSessionIds).toEqual(['q2', 'q3', 'q4', 'q5', 'q6']);
      expect(controller.getQueueLength()).toBe(0);
    });

    it('drops oldest turn when queue is full and logs warning', () => {
      createVoiceLoopController({ bus, gateway, settings: () => settings });

      const logSpy = vi.fn();
      bus.on('log', logSpy);

      // First turn fires immediately
      bus.emit('audio:recording-stop', { sessionId: 'first', blob: makeAudioBlob('first') });

      // Fill queue to max (5 turns)
      for (let i = 1; i <= 5; i++) {
        bus.emit('audio:recording-stop', { sessionId: `q${i}`, blob: makeAudioBlob(`q${i}`) });
      }

      // 6th queued turn should trigger warning
      bus.emit('audio:recording-stop', { sessionId: 'overflow', blob: makeAudioBlob('overflow') });

      const warnCalls = logSpy.mock.calls.filter(
        (args) => args[0].level === 'warn' && args[0].msg.includes('Voice queue full'),
      );
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('response_delta does NOT drain queue (only response_end and error)', () => {
      createVoiceLoopController({ bus, gateway, settings: () => settings });

      bus.emit('audio:recording-stop', { sessionId: 's1', blob: makeAudioBlob('a1') });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: makeAudioBlob('a2') });

      // response_delta should NOT trigger drain
      gateway.simulateChunk({ type: 'response_delta', text: 'hello' });

      expect(gateway.sendVoiceTurn).toHaveBeenCalledOnce();
    });

    it('getQueueLength returns current queue size', () => {
      const controller = createVoiceLoopController({ bus, gateway, settings: () => settings });

      expect(controller.getQueueLength()).toBe(0);

      // First fires immediately (queue stays empty)
      bus.emit('audio:recording-stop', { sessionId: 's1', blob: makeAudioBlob('a1') });
      expect(controller.getQueueLength()).toBe(0);

      // Second is queued
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: makeAudioBlob('a2') });
      expect(controller.getQueueLength()).toBe(1);

      // Third is queued
      bus.emit('audio:recording-stop', { sessionId: 's3', blob: makeAudioBlob('a3') });
      expect(controller.getQueueLength()).toBe(2);

      // Drain one
      gateway.simulateChunk({ type: 'response_end' });
      expect(controller.getQueueLength()).toBe(1);
    });

    it('logs queue remaining count when sending', () => {
      createVoiceLoopController({ bus, gateway, settings: () => settings });

      const logSpy = vi.fn();
      bus.on('log', logSpy);

      bus.emit('audio:recording-stop', { sessionId: 's1', blob: makeAudioBlob('a1') });
      bus.emit('audio:recording-stop', { sessionId: 's2', blob: makeAudioBlob('a2') });

      // Drain queue
      gateway.simulateChunk({ type: 'response_end' });

      // Check log messages contain queue remaining info
      const sendLogs = logSpy.mock.calls.filter(
        (args) =>
          args[0].level === 'info' && args[0].msg.includes('Sending voice turn') && args[0].msg.includes('remaining'),
      );
      expect(sendLogs.length).toBeGreaterThanOrEqual(1);

      // Verify at least one log shows the queue count
      const msgs = sendLogs.map((args) => args[0].msg as string);
      expect(msgs.some((m) => m.includes('(queue: 0 remaining)'))).toBe(true);
    });
  });
});
