// ── Tests for audio capture service ─────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAudioCapture, type AudioCapture } from '../audio/audio-capture';

/** Read blob content as Uint8Array (jsdom Blob lacks arrayBuffer()) */
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('AudioCapture - glasses mode (devMode=false)', () => {
  let capture: AudioCapture;

  beforeEach(() => {
    capture = createAudioCapture(false);
  });

  it('isRecording() returns false before start', () => {
    expect(capture.isRecording()).toBe(false);
  });

  it('startRecording sets isRecording to true', () => {
    capture.startRecording('sess-1');
    expect(capture.isRecording()).toBe(true);
  });

  it('stopRecording sets isRecording to false', async () => {
    capture.startRecording('sess-1');
    await capture.stopRecording();
    expect(capture.isRecording()).toBe(false);
  });

  it('onFrame accumulates frames when recording', () => {
    capture.startRecording('sess-1');

    capture.onFrame(new Uint8Array([1, 2, 3]));
    capture.onFrame(new Uint8Array([4, 5]));

    // Recording flag is still true
    expect(capture.isRecording()).toBe(true);
  });

  it('onFrame ignores frames when not recording', async () => {
    capture.onFrame(new Uint8Array([1, 2, 3]));

    // Start and immediately stop to get the blob
    capture.startRecording('sess-1');
    const blob = await capture.stopRecording();

    // Should be empty since frame was pushed before recording started
    expect(blob.size).toBe(0);
  });

  it('stopRecording concatenates all frames into a single Blob of type audio/pcm', async () => {
    capture.startRecording('sess-1');

    capture.onFrame(new Uint8Array([1, 2, 3]));
    capture.onFrame(new Uint8Array([4, 5]));
    capture.onFrame(new Uint8Array([6]));

    const blob = await capture.stopRecording();

    expect(blob.type).toBe('audio/pcm');
    expect(blob.size).toBe(6); // 3 + 2 + 1

    // Verify blob content
    const buffer = await readBlob(blob);
    expect(Array.from(buffer)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stopRecording returns Blob with correct total byte length', async () => {
    capture.startRecording('sess-1');

    // Simulate 40-byte PCM frames (real SDK frame size)
    const frame1 = new Uint8Array(40).fill(0xaa);
    const frame2 = new Uint8Array(40).fill(0xbb);
    const frame3 = new Uint8Array(40).fill(0xcc);

    capture.onFrame(frame1);
    capture.onFrame(frame2);
    capture.onFrame(frame3);

    const blob = await capture.stopRecording();

    expect(blob.size).toBe(120); // 40 * 3
  });

  it('multiple start/stop cycles work correctly (frames reset on start)', async () => {
    // First cycle
    capture.startRecording('sess-1');
    capture.onFrame(new Uint8Array([1, 2, 3]));
    const blob1 = await capture.stopRecording();
    expect(blob1.size).toBe(3);

    // Second cycle — frames from first cycle should NOT carry over
    capture.startRecording('sess-2');
    capture.onFrame(new Uint8Array([4, 5]));
    const blob2 = await capture.stopRecording();
    expect(blob2.size).toBe(2);

    const buffer = await readBlob(blob2);
    expect(Array.from(buffer)).toEqual([4, 5]);
  });

  it('stopRecording returns empty Blob when no frames were captured', async () => {
    capture.startRecording('sess-1');
    const blob = await capture.stopRecording();

    expect(blob.size).toBe(0);
    expect(blob.type).toBe('audio/pcm');
  });

  it('onFrame is synchronous — does not return a promise', () => {
    capture.startRecording('sess-1');

    // onFrame should return void (undefined), not a Promise
    const result = capture.onFrame(new Uint8Array([1]));
    expect(result).toBeUndefined();
  });
});

describe('AudioCapture - dev mode (devMode=true)', () => {
  let capture: AudioCapture;

  // Mock MediaRecorder
  let mockMediaRecorder: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    ondataavailable: ((e: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
    stream: { getTracks: () => Array<{ stop: () => void }> };
  };

  let mockStopTrack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStopTrack = vi.fn();
    mockMediaRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null,
      onstop: null,
      stream: {
        getTracks: () => [{ stop: mockStopTrack }],
      },
    };

    // Mock navigator.mediaDevices.getUserMedia
    const mockStream = {} as MediaStream;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Mock MediaRecorder constructor
    vi.stubGlobal(
      'MediaRecorder',
      vi.fn().mockImplementation(() => mockMediaRecorder),
    );

    capture = createAudioCapture(true);
  });

  it('onFrame does NOT accumulate frames in dev mode', async () => {
    capture.startRecording('sess-1');

    // Wait for getUserMedia promise to resolve
    await vi.waitFor(() => {
      expect(MediaRecorder).toHaveBeenCalledOnce();
    });

    capture.onFrame(new Uint8Array([1, 2, 3]));

    // Simulate MediaRecorder stopping with empty chunks
    const stopPromise = capture.stopRecording();
    // Trigger onstop callback
    mockMediaRecorder.onstop?.();
    const blob = await stopPromise;

    // Should be an empty webm blob (no chunks), not PCM data
    expect(blob.type).toBe('audio/webm');
    expect(blob.size).toBe(0);
  });

  it('startRecording creates MediaRecorder from getUserMedia stream', async () => {
    capture.startRecording('sess-1');

    // Wait for async getUserMedia
    await vi.waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: true,
      });
    });

    expect(MediaRecorder).toHaveBeenCalledOnce();
    expect(mockMediaRecorder.start).toHaveBeenCalledWith(100);
  });

  it('stopRecording returns webm Blob from MediaRecorder chunks', async () => {
    capture.startRecording('sess-1');

    await vi.waitFor(() => {
      expect(MediaRecorder).toHaveBeenCalledOnce();
    });

    // Simulate data available
    const chunk1 = new Blob(['audio-data-1']);
    const chunk2 = new Blob(['audio-data-2']);
    mockMediaRecorder.ondataavailable!({ data: chunk1 });
    mockMediaRecorder.ondataavailable!({ data: chunk2 });

    const stopPromise = capture.stopRecording();

    // Trigger onstop
    mockMediaRecorder.onstop?.();

    const blob = await stopPromise;
    expect(blob.type).toBe('audio/webm');
    // Size should be the combined chunk sizes
    expect(blob.size).toBeGreaterThan(0);
  });

  it('stopRecording stops tracks on the media stream', async () => {
    capture.startRecording('sess-1');

    await vi.waitFor(() => {
      expect(MediaRecorder).toHaveBeenCalledOnce();
    });

    const stopPromise = capture.stopRecording();
    mockMediaRecorder.onstop?.();
    await stopPromise;

    expect(mockStopTrack).toHaveBeenCalledOnce();
  });
});
