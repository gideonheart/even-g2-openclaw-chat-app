// ── Shared bridge service interface ─────────────────────────
// Both the real EvenBridge and the dev-mode mock implement this interface.

export interface BridgeService {
  init(): Promise<void>;
  destroy(): Promise<void>;
  startAudio(): Promise<boolean>;
  stopAudio(): Promise<boolean>;
}
