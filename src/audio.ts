import type { BootedHud } from '@open-slot-ui/pixi';

const BASE = 'assets';
const DEFAULT_VOLUME = 0.5;
const DUCK_FACTOR = 0.18; // how far to lower the music under a win jingle
const FADE_MS = 500;

let duckImpl: (ducked: boolean) => void = () => undefined;
/** Temporarily lower the background music (e.g. while a big-win jingle plays). */
export function duckMusic(ducked: boolean): void {
  duckImpl(ducked);
}

let bonusImpl: (on: boolean) => void = () => undefined;
/** Swap the main-game loop for the bonus loop while the Hold & Win runs. */
export function setBonusMusic(on: boolean): void {
  bonusImpl(on);
}

/** Linear volume fade; resolves/acts via the `done` callback when finished. */
function fade(el: HTMLAudioElement, to: number, done?: () => void): number {
  const from = el.volume;
  const start = performance.now();
  const id = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t >= 1) {
      window.clearInterval(id);
      done?.();
    }
  }, 33);
  return id;
}

/**
 * Background music wired to the HUD's sound controls: the main-game loop
 * (`main.mp3`) and a bonus loop (`bonus.mp3`) that takes over during the
 * Hold & Win. If the bonus track can't play, the main loop keeps going.
 */
export function initAudio(hud: BootedHud): void {
  const main = new Audio(`${BASE}/main.mp3`);
  main.loop = true;
  main.preload = 'auto';
  const bonus = new Audio(`${BASE}/bonus.mp3`);
  bonus.loop = true;
  bonus.preload = 'auto';

  const ui = hud.ui;
  let unlocked = false;
  let baseVolume = DEFAULT_VOLUME;
  let ducked = false;
  let inBonus = false;
  let fadeId = 0;

  const target = (): number => baseVolume * (ducked ? DUCK_FACTOR : 1);
  const active = (): HTMLAudioElement => (inBonus ? bonus : main);
  const idle = (): HTMLAudioElement => (inBonus ? main : bonus);

  const applyVolume = (): void => {
    active().volume = target();
    idle().volume = 0;
  };

  const apply = (): void => {
    const muted = ui.muted.get();
    main.muted = muted;
    bonus.muted = muted;
    if (unlocked && !muted) void active().play().catch(() => undefined);
  };

  applyVolume();

  const unlock = (): void => {
    if (unlocked) return;
    unlocked = true;
    apply();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  ui.muted.subscribe(() => apply());

  hud.on('valueChanged', ({ id, value }) => {
    if (id !== 'music') return;
    baseVolume = Math.max(0, Math.min(1, value));
    applyVolume();
    apply();
  });

  duckImpl = (d: boolean): void => {
    ducked = d;
    window.clearInterval(fadeId);
    fadeId = fade(active(), target());
  };

  bonusImpl = (on: boolean): void => {
    if (on === inBonus) return;
    const prev = active();
    inBonus = on;
    const next = active();
    window.clearInterval(fadeId);

    const startNext = (): void => {
      next.volume = 0;
      if (unlocked && !ui.muted.get()) {
        if (on) next.currentTime = 0;
        void next.play().catch(() => undefined);
      }
      fade(next, target());
    };

    // Fade the old track out and pause it; bring the new one in. If the bonus
    // track fails to start, fall back to the main loop so it never goes silent.
    fade(prev, 0, () => {
      if (on) {
        next
          .play()
          .then(() => {
            prev.pause();
            startNext();
          })
          .catch(() => {
            inBonus = false;
            fade(main, target());
            if (unlocked && !ui.muted.get()) void main.play().catch(() => undefined);
          });
      } else {
        prev.pause();
        startNext();
      }
    });
  };
}
