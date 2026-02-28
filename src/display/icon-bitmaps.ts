// ── Unicode text icon definitions ──────────────────────────
// Per research Open Question #3: use Unicode text icons instead of image
// containers for v1. This eliminates the 4-bit pixel packing ambiguity
// and reduces container count.

import type { IconState } from '../types';

/**
 * Frame arrays for each icon state. Each frame is a Unicode string
 * rendered via textContainerUpgrade on the glasses display.
 */
export const ICON_FRAMES: Record<IconState, string[]> = {
  idle: ['\u25CC'],                                                     // ◌ -- open circle
  recording: ['\u25CF', '\u25CB'],                                      // ● ○ -- 2-frame blink
  sent: ['\u2713'],                                                     // ✓ -- checkmark
  thinking: ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'], // braille spinner
};
