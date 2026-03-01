// ── Tests for audio capture service ─────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAudioCapture, pcm16ToWav, type AudioCapture } from '../audio/audio-capture';

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

    // Should be a WAV with no PCM data (44-byte header only) since frame was
    // pushed before recording started
    expect(blob.size).toBe(44);
  });

  it('stopRecording concatenates all frames and wraps them in a WAV (RIFF) container', async () => {
    capture.startRecording('sess-1');

    capture.onFrame(new Uint8Array([1, 2, 3]));
    capture.onFrame(new Uint8Array([4, 5]));
    capture.onFrame(new Uint8Array([6]));

    const blob = await capture.stopRecording();

    // Glasses-mode output must be audio/wav for STT backends to decode it
    expect(blob.type).toBe('audio/wav');
    // 44-byte WAV header + 6 bytes of PCM data
    expect(blob.size).toBe(44 + 6);

    // Verify WAV header: starts with 'RIFF'
    const buffer = await readBlob(blob);
    const riff = String.fromCharCode(...Array.from(buffer.slice(0, 4)));
    expect(riff).toBe('RIFF');

    // Verify PCM data follows at offset 44
    expect(Array.from(buffer.slice(44))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stopRecording returns WAV Blob with correct total byte length', async () => {
    capture.startRecording('sess-1');

    // Simulate 40-byte PCM frames (real SDK frame size)
    const frame1 = new Uint8Array(40).fill(0xaa);
    const frame2 = new Uint8Array(40).fill(0xbb);
    const frame3 = new Uint8Array(40).fill(0xcc);

    capture.onFrame(frame1);
    capture.onFrame(frame2);
    capture.onFrame(frame3);

    const blob = await capture.stopRecording();

    // 44-byte WAV header + 120 bytes of PCM data
    expect(blob.size).toBe(44 + 120);
  });

  it('multiple start/stop cycles work correctly (frames reset on start)', async () => {
    // First cycle
    capture.startRecording('sess-1');
    capture.onFrame(new Uint8Array([1, 2, 3]));
    const blob1 = await capture.stopRecording();
    // 44-byte WAV header + 3 bytes of PCM
    expect(blob1.size).toBe(44 + 3);

    // Second cycle — frames from first cycle should NOT carry over
    capture.startRecording('sess-2');
    capture.onFrame(new Uint8Array([4, 5]));
    const blob2 = await capture.stopRecording();
    // 44-byte WAV header + 2 bytes of PCM
    expect(blob2.size).toBe(44 + 2);

    // Verify PCM data at offset 44 in the second blob
    const buffer = await readBlob(blob2);
    expect(Array.from(buffer.slice(44))).toEqual([4, 5]);
  });

  it('stopRecording returns WAV Blob with only a header when no frames were captured', async () => {
    capture.startRecording('sess-1');
    const blob = await capture.stopRecording();

    // WAV header is always 44 bytes; no PCM data means dataSize=0
    expect(blob.size).toBe(44);
    expect(blob.type).toBe('audio/wav');
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

describe('pcm16ToWav', () => {
  it('returns a Blob of type audio/wav', () => {
    const pcm = new Uint8Array(80); // 2 frames worth of silence
    const wav = pcm16ToWav(pcm);
    expect(wav.type).toBe('audio/wav');
  });

  it('output size is 44-byte header + PCM data length', () => {
    const pcm = new Uint8Array(160);
    const wav = pcm16ToWav(pcm);
    expect(wav.size).toBe(44 + 160);
  });

  it('starts with RIFF header', async () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const wav = pcm16ToWav(pcm);
    const buffer = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(wav);
    });
    expect(String.fromCharCode(...Array.from(buffer.slice(0, 4)))).toBe('RIFF');
    expect(String.fromCharCode(...Array.from(buffer.slice(8, 12)))).toBe('WAVE');
    expect(String.fromCharCode(...Array.from(buffer.slice(12, 16)))).toBe('fmt ');
    expect(String.fromCharCode(...Array.from(buffer.slice(36, 40)))).toBe('data');
  });

  it('encodes correct sample rate (16000 Hz) in header', async () => {
    const pcm = new Uint8Array(40);
    const wav = pcm16ToWav(pcm);
    const buffer = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(wav);
    });
    const view = new DataView(buffer.buffer);
    // Sample rate at offset 24 (little-endian uint32)
    expect(view.getUint32(24, true)).toBe(16000);
    // Bits per sample at offset 34 (little-endian uint16)
    expect(view.getUint16(34, true)).toBe(16);
    // Channels at offset 22 (little-endian uint16)
    expect(view.getUint16(22, true)).toBe(1);
  });

  it('preserves PCM bytes at offset 44', async () => {
    const pcm = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
    const wav = pcm16ToWav(pcm);
    const buffer = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(wav);
    });
    expect(Array.from(buffer.slice(44))).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
  });
});
