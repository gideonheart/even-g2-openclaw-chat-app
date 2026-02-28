// ── Shared bridge service interface ─────────────────────────
// Both the real EvenBridge and the dev-mode mock implement this interface.

/** Plain object shape for a text container in a page layout. SDK-free. */
export interface TextContainerConfig {
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  containerID: number;
  containerName: string;
  isEventCapture: number;
  content: string;
}

/** Plain object shape for rebuildPageContainer config. SDK-free. */
export interface PageContainerConfig {
  containerTotalNum: number;
  textObject: TextContainerConfig[];
}

export interface BridgeService {
  init(): Promise<void>;
  destroy(): Promise<void>;
  startAudio(): Promise<boolean>;
  stopAudio(): Promise<boolean>;
  textContainerUpgrade(containerID: number, content: string): Promise<boolean>;
  rebuildPageContainer(config: PageContainerConfig): Promise<boolean>;
}
