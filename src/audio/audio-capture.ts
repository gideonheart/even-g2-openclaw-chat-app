// ── Audio capture service — glasses PCM frames + browser MediaRecorder ──
//
// In glasses mode (devMode=false): buffers raw PCM Uint8Array frames
// pushed by the bridge via onFrame(). On stopRecording(), concatenates
// all frames into a single Blob of type 'audio/pcm'.
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
}

export function createAudioCapture(devMode: boolean): AudioCapture {
  let frames: Uint8Array[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  let mediaChunks: Blob[] = [];
  let recording = false;

  function startRecording(_sessionId: string): void {
    frames = [];
    mediaChunks = [];
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

    // Glasses mode: concatenate all PCM frames into a single buffer
    const totalLen = frames.reduce((sum, f) => sum + f.length, 0);
    const buffer = new Uint8Array(totalLen);
    let offset = 0;
    for (const frame of frames) {
      buffer.set(frame, offset);
      offset += frame.length;
    }
    frames = [];
    return new Blob([buffer], { type: 'audio/pcm' });
  }

  function isRecordingFn(): boolean {
    return recording;
  }

  return {
    startRecording,
    stopRecording,
    onFrame,
    isRecording: isRecordingFn,
  };
}
