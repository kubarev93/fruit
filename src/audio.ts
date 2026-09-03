import type { BootedHud } from '@open-slot-ui/pixi';

const BASE = 'assets';
const DEFAULT_VOLUME = 0.5;
const DUCK_FACTOR = 0.18; // how far to lower the music under a win jingle

// Shared singleton so the game can duck the music under big-win jingles.
let duckImpl: (ducked: boolean) => void = () => undefined;
/** Temporarily lower the background music (e.g. while a big-win jingle plays). */
export function duckMusic(ducked: boolean): void {
  duckImpl(ducked);
}

/**
 * Background music (`main.mp3`), wired to the HUD's sound controls.
 *
 * Browsers block audio until a user gesture, so playback starts on the first
 * pointer/keypress. The HUD's master mute (`ui.muted`) and the Music volume
 * slider (`valueChanged` id `music`) drive mute state and volume.
 */
export function initAudio(hud: BootedHud): void {
  const music = new Audio(`${BASE}/main.mp3`);
  music.loop = true;
  music.preload = 'auto';

  const ui = hud.ui;
  let unlocked = false;
  let baseVolume = DEFAULT_VOLUME;
  let ducked = false;
  const applyVolume = (): void => {
    music.volume = baseVolume * (ducked ? DUCK_FACTOR : 1);
  };
  applyVolume();

  const apply = (): void => {
    music.muted = ui.muted.get();
    if (unlocked && !music.muted) void music.play().catch(() => undefined);
  };

  // Autoplay policy: kick playback off the first user gesture, then detach.
  const unlock = (): void => {
    if (unlocked) return;
    unlocked = true;
    apply();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // Master mute toggle.
  ui.muted.subscribe(() => apply());

  // Music volume slider (0..1).
  hud.on('valueChanged', ({ id, value }) => {
    if (id !== 'music') return;
    baseVolume = Math.max(0, Math.min(1, value));
    applyVolume();
    apply();
  });

  duckImpl = (d: boolean): void => {
    ducked = d;
    applyVolume();
  };
}
