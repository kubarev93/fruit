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

// Shared singletons so any module can trigger/stop a sound without threading it.
let playImpl: (name: string) => void = () => undefined;
let stopImpl: (name?: string) => void = () => undefined;
export function playSfx(name: string): void {
  playImpl(name);
}
/** Stop a named sound, or every sound when called with no name. */
export function stopSfx(name?: string): void {
  stopImpl(name);
}

export async function initSfx(hud: BootedHud): Promise<void> {
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  const ui = hud.ui;
  let muted = ui.muted.get();
  let volume = 0.7;
  gain.gain.value = muted ? 0 : volume;

  // Track live sources so we can stop them (and silence on mute).
  const active = new Map<string, Set<AudioBufferSourceNode>>();
  const stop = (name?: string): void => {
    const kill = (set: Set<AudioBufferSourceNode>): void => {
      for (const src of set) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }
      set.clear();
    };
    if (name) {
      const set = active.get(name);
      if (set) kill(set);
    } else {
      for (const set of active.values()) kill(set);
    }
  };
  stopImpl = stop;

  ui.muted.subscribe((m) => {
    muted = m;
    gain.gain.value = m ? 0 : volume;
    if (m) stop(); // silence anything already playing, immediately
  });
  hud.on('valueChanged', ({ id, value }) => {
    if (id !== 'sfx') return;
    volume = Math.max(0, Math.min(1, value));
    if (!muted) gain.gain.value = volume;
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

  playImpl = (name: string): void => {
    if (muted) return;
    const clip = clips.get(name);
    if (!clip) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(gain);
    let set = active.get(name);
    if (!set) active.set(name, (set = new Set()));
    set.add(src);
    src.onended = (): void => {
      set!.delete(src);
    };
    src.start(0, clip.start, clip.dur);
  };
}
