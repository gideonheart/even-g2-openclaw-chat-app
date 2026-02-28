// ── Tests for VoiceLoopController — gateway-to-bus event bridging ──
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from '../events';
import type { AppEventMap, AppSettings, VoiceTurnChunk, ConnectionStatus } from '../types';
import { createVoiceLoopController } from '../voice-loop-controller';

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

    const blob = new Blob(['audio-data']);
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

    const blob1 = new Blob(['audio1']);
    bus.emit('audio:recording-stop', { sessionId: 's1', blob: blob1 });

    expect(gateway.sendVoiceTurn.mock.calls[0][1].sttProvider).toBe('whisperx');

    // Change settings between recording-stop events
    currentSettings = makeSettings({ sttProvider: 'openai' });

    const blob2 = new Blob(['audio2']);
    bus.emit('audio:recording-stop', { sessionId: 's2', blob: blob2 });

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
});
