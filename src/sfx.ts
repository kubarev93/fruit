import type { BootedHud } from '@open-slot-ui/pixi';

/**
 * Audio-sprite sound engine, driven by the pack's `zvuki.json`: two AAC files
 * (`keypad.mp4` UI sounds, `effects.mp4` game sounds), each a name → [startMs,
 * durationMs] map. Sounds are decoded once and played as sub-ranges via the Web
 * Audio API (so they can overlap). Respects the HUD's mute + SFX volume, and
 * unlocks on the first user gesture (autoplay policy).
 */

const BASE = 'assets/sfx';

interface ZvukiEntry {
  name: string;
  src: string[];
  sprite: Record<string, [number, number]>;
}
interface Clip {
  buffer: AudioBuffer;
  start: number; // seconds
  dur: number; // seconds
}

// Shared singleton so any module can trigger a sound without threading it through.
let play: (name: string) => void = () => undefined;
export function playSfx(name: string): void {
  play(name);
}

export async function initSfx(hud: BootedHud): Promise<void> {
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const gain = ctx.createGain();
  gain.gain.value = 0.7;
  gain.connect(ctx.destination);

  const ui = hud.ui;
  let muted = ui.muted.get();
  ui.muted.subscribe((m) => {
    muted = m;
  });
  hud.on('valueChanged', ({ id, value }) => {
    if (id === 'sfx') gain.gain.value = Math.max(0, Math.min(1, value));
  });

  // Autoplay policy: audio is suspended until a user gesture.
  const unlock = (): void => {
    void ctx.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const clips = new Map<string, Clip>();
  try {
    const banks: ZvukiEntry[] = await (await fetch(`${BASE}/zvuki.json`)).json();
    await Promise.all(
      banks.map(async (bank) => {
        const buf = await ctx.decodeAudioData(await (await fetch(`${BASE}/${bank.src[0]}`)).arrayBuffer());
        for (const [name, [startMs, durMs]] of Object.entries(bank.sprite)) {
          clips.set(name, { buffer: buf, start: startMs / 1000, dur: durMs / 1000 });
        }
      }),
    );
  } catch {
    return; // audio failed to load — stay silent, never break the game
  }

  play = (name: string): void => {
    if (muted) return;
    const clip = clips.get(name);
    if (!clip) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(gain);
    src.start(0, clip.start, clip.dur);
  };
}
