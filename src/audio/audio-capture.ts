// ── Audio capture service — glasses PCM frames + browser MediaRecorder ──
//
// In glasses mode (devMode=false): buffers raw PCM Uint8Array frames
// pushed by the bridge via onFrame(). On stopRecording(), concatenates
// all frames and wraps them in a WAV (RIFF) container so the gateway
// and STT backend receive a standard decodable audio format.
//
// PCM parameters from Even G2 SDK: 16 kHz sample rate, 16-bit samples,
// mono channel, little-endian byte order (40 bytes per 10 ms frame).
//
// In dev mode (devMode=true): uses the browser MediaRecorder API to
// capture audio from the device microphone. onFrame() is a no-op.
//
// CRITICAL: onFrame() runs at ~100Hz. It must be fully synchronous.

export interface AudioCapture {
  startRecording(sessionId: string): void;
  stopRecording(): Promise<Blob>;
  onFrame(pcm: Uint8Array): void;
  isRecording(): boolean;
  getFrameCount(): number;
}

/**
 * Minimum audio payload in bytes for meaningful speech.
 * 50ms of 16 kHz, 16-bit, mono PCM = 1600 bytes.
 * Anything shorter will almost certainly produce hallucinated STT output.
 */
export const MIN_AUDIO_BYTES = 1600;

/**
 * Wrap raw PCM bytes in a WAV (RIFF) container.
 *
 * Even G2 glasses emit 16 kHz, 16-bit, mono PCM (little-endian, 40 bytes/frame).
 * Standard STT backends (WhisperX, OpenAI Whisper) require a proper audio
 * container -- they cannot decode raw PCM. This matches the reference sample
 * (stt-even-g2/g2/main.ts pcm16ToWav) exactly.
 */
export function pcm16ToWav(
  pcmBytes: Uint8Array,
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16,
): Blob {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(off + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

export function createAudioCapture(devMode: boolean): AudioCapture {
  let frames: Uint8Array[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  let mediaChunks: Blob[] = [];
  let recording = false;
  let frameCount = 0;

  function startRecording(_sessionId: string): void {
    frames = [];
    mediaChunks = [];
    frameCount = 0;
    recording = true;

    if (devMode) {
      // Browser microphone fallback
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          mediaRecorder = new MediaRecorder(stream);
          mediaChunks = [];
          mediaRecorder.ondataavailable = (e) => mediaChunks.push(e.data);
          mediaRecorder.start(100); // 100ms timeslice
        });
    }
  }

  function onFrame(pcm: Uint8Array): void {
    // Only accumulate frames in glasses mode while recording.
    // This must be fully synchronous — no await, no async.
    if (recording && !devMode) {
      frames.push(pcm);
      frameCount++;
    }
  }

  async function stopRecording(): Promise<Blob> {
    recording = false;

    if (devMode && mediaRecorder) {
      return new Promise<Blob>((resolve) => {
        mediaRecorder!.onstop = () => {
          resolve(new Blob(mediaChunks, { type: 'audio/webm' }));
          mediaRecorder = null;
        };
        mediaRecorder!.stop();
        mediaRecorder!.stream.getTracks().forEach((t) => t.stop());
      });
    }

    // Glasses mode: concatenate all PCM frames and wrap in WAV container.
    // Even G2 sends 16 kHz / 16-bit / mono PCM. Raw PCM is not decodable by
    // standard STT backends -- it must be wrapped in a WAV (RIFF) container.
    const totalLen = frames.reduce((sum, f) => sum + f.length, 0);

    if (totalLen < MIN_AUDIO_BYTES) {
      console.warn(`[AudioCapture] Warning: only ${totalLen} bytes (${frameCount} frames) captured — audio may be empty/silent`);
    }

    const pcm = new Uint8Array(totalLen);
    let offset = 0;
    for (const frame of frames) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    frames = [];
    return pcm16ToWav(pcm);
  }

  function isRecordingFn(): boolean {
    return recording;
  }

  function getFrameCount(): number {
    return frameCount;
  }

  return {
    startRecording,
    stopRecording,
    onFrame,
    isRecording: isRecordingFn,
    getFrameCount,
  };
}
