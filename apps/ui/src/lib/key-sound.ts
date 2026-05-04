// Mechanical-keyboard sound engine.
//
// Strategy:
// 1. Pre-render a small pool of AudioBuffer variations per "kind" (normal,
//    space, enter, backspace, modifier) once on first use. Each variation is
//    a multi-layer synthesized switch click (housing thump + stem thock +
//    bottom-out tap + transient noise) shaped to mimic recordings of soft
//    Cherry MX-style switches. Playing back a randomly-picked pre-rendered
//    buffer per keystroke is what gives Klack-like "no two presses sound
//    identical" feel without any asset bundle.
// 2. Optional Mechvibes-format custom pack loader. Drop a config.json + WAVs
//    in `apps/ui/public/sounds/packs/<name>/` and the engine will use those
//    recordings instead of the synth. Format: single-sprite (sound + defines:
//    keycode -> [start_ms, dur_ms]) OR multi-file (defines: keycode -> file).
// 3. Press vs release: each keystroke fires a "down" sound; on `keyup`, a
//    quieter "up" sound plays so it feels like the switch resetting.

export type KeySoundPack = "soft" | "typewriter" | "mechanical";
export type KeyKind = "normal" | "space" | "enter" | "backspace" | "modifier";

interface PackVoice {
  // Body resonance (housing thump). Low, big.
  housingFreq: number;
  housingQ: number;
  housingDecay: number;
  housingGain: number;
  // Stem thock (key stem bottoming out). Mid, focused.
  stemFreq: number;
  stemQ: number;
  stemDecay: number;
  stemGain: number;
  // Transient click (plastic-on-plastic tick).
  clickFreq: number;
  clickDecay: number;
  clickGain: number;
  // Bottom-out thump tail.
  tailFreq: number;
  tailDecay: number;
  tailGain: number;
}

const PACKS: Record<KeySoundPack, PackVoice> = {
  // Cherry MX Brown / Silent Red feel. Softest of the three.
  soft: {
    housingFreq: 95,
    housingQ: 4,
    housingDecay: 0.035,
    housingGain: 0.45,
    stemFreq: 220,
    stemQ: 9,
    stemDecay: 0.05,
    stemGain: 0.3,
    clickFreq: 3400,
    clickDecay: 0.005,
    clickGain: 0.1,
    tailFreq: 60,
    tailDecay: 0.08,
    tailGain: 0.18,
  },
  // IBM Selectric / Olivetti typewriter feel. Higher click, longer tail.
  typewriter: {
    housingFreq: 130,
    housingQ: 3,
    housingDecay: 0.06,
    housingGain: 0.35,
    stemFreq: 290,
    stemQ: 6,
    stemDecay: 0.075,
    stemGain: 0.32,
    clickFreq: 4800,
    clickDecay: 0.012,
    clickGain: 0.32,
    tailFreq: 80,
    tailDecay: 0.11,
    tailGain: 0.2,
  },
  // Cherry MX Blue / NovelKeys Cream feel. Sharper click, more body.
  mechanical: {
    housingFreq: 110,
    housingQ: 5,
    housingDecay: 0.045,
    housingGain: 0.5,
    stemFreq: 340,
    stemQ: 10,
    stemDecay: 0.06,
    stemGain: 0.4,
    clickFreq: 5200,
    clickDecay: 0.008,
    clickGain: 0.36,
    tailFreq: 70,
    tailDecay: 0.09,
    tailGain: 0.24,
  },
};

const KIND_PITCH: Record<KeyKind, number> = {
  normal: 1.0,
  space: 0.74,
  enter: 0.8,
  backspace: 0.9,
  modifier: 1.06,
};

const KIND_GAIN: Record<KeyKind, number> = {
  normal: 1.0,
  space: 1.4,
  enter: 1.25,
  backspace: 0.95,
  modifier: 0.65,
};

const POOL_SIZE = 5;
const THROTTLE_MS = 14;

// Mechvibes-compatible pack manifest. Either single-sprite (sound + defines
// mapping keycode -> [startMs, durMs]) or per-file (defines mapping keycode
// -> filename relative to the pack folder).
export interface MechvibesConfig {
  id?: string;
  name?: string;
  key_define_type?: "single" | "multi";
  includes_numpad?: boolean;
  sound?: string;
  defines?: Record<string, [number, number] | string | null>;
}

interface CustomPack {
  config: MechvibesConfig;
  baseUrl: string;
  spriteBuffer: AudioBuffer | null;
  perKeyBuffers: Map<string, AudioBuffer>;
}

class KeySoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private downPool: Map<KeyKind, AudioBuffer[]> = new Map();
  private upPool: Map<KeyKind, AudioBuffer[]> = new Map();
  private lastPlayAt = 0;
  private enabled = false;
  private volume = 0.3;
  private pack: KeySoundPack = "soft";
  private currentVoice: PackVoice = PACKS.soft;
  private rendered = false;
  private custom: CustomPack | null = null;

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.ensureContext();
  }
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }
  setPack(p: KeySoundPack): void {
    if (p === this.pack && this.rendered) return;
    this.pack = p;
    this.currentVoice = PACKS[p];
    this.rendered = false;
    this.downPool.clear();
    this.upPool.clear();
    if (this.ctx) void this.renderPool();
  }

  // Loads a Mechvibes-format pack. Pass the public URL of the folder
  // (must end with `/`). null clears and returns to synth.
  async loadCustomPack(baseUrl: string | null): Promise<void> {
    if (!baseUrl) {
      this.custom = null;
      return;
    }
    this.ensureContext();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const url = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    try {
      const cfg = (await fetch(url + "config.json").then((r) => r.json())) as
        MechvibesConfig;
      const pack: CustomPack = {
        config: cfg,
        baseUrl: url,
        spriteBuffer: null,
        perKeyBuffers: new Map(),
      };
      if (cfg.key_define_type === "multi" && cfg.defines) {
        const entries = Object.entries(cfg.defines).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        );
        await Promise.all(
          entries.map(async ([code, file]) => {
            const buf = await fetch(url + file)
              .then((r) => r.arrayBuffer())
              .then((b) => ctx.decodeAudioData(b));
            pack.perKeyBuffers.set(code, buf);
          }),
        );
      } else if (cfg.sound) {
        pack.spriteBuffer = await fetch(url + cfg.sound)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b));
      }
      this.custom = pack;
    } catch {
      this.custom = null;
    }
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    void this.renderPool();
  }

  private async renderPool(): Promise<void> {
    if (!this.ctx) return;
    const kinds: KeyKind[] = [
      "normal",
      "space",
      "enter",
      "backspace",
      "modifier",
    ];
    for (const kind of kinds) {
      const downs: AudioBuffer[] = [];
      const ups: AudioBuffer[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        downs.push(await this.renderOne(kind, false));
        ups.push(await this.renderOne(kind, true));
      }
      this.downPool.set(kind, downs);
      this.upPool.set(kind, ups);
    }
    this.rendered = true;
  }

  private async renderOne(kind: KeyKind, isUp: boolean): Promise<AudioBuffer> {
    const sr = 44100;
    const duration = 0.18;
    // OfflineAudioContext renders deterministically into a buffer.
    const off = new OfflineAudioContext(2, Math.ceil(sr * duration), sr);
    const v = this.currentVoice;
    const pitchJitter = 1 + (Math.random() - 0.5) * 0.1;
    const kindPitch = KIND_PITCH[kind];
    const detune = pitchJitter * kindPitch * (isUp ? 1.15 : 1);
    const gainMul = KIND_GAIN[kind] * (isUp ? 0.42 : 1);

    // Shared white-noise source for the layers below. A new buffer each
    // render gives natural micro-variation across the pool.
    const noiseLen = Math.ceil(sr * 0.2);
    const noiseBuf = off.createBuffer(1, noiseLen, sr);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;

    const masterGain = off.createGain();
    masterGain.gain.value = gainMul;
    // Subtle stereo widening: pan each layer slightly differently.
    const panL = off.createStereoPanner();
    panL.pan.value = -0.06;
    const panR = off.createStereoPanner();
    panR.pan.value = 0.06;
    const panC = off.createStereoPanner();
    panC.pan.value = 0;
    masterGain.connect(off.destination);

    const t0 = 0;

    // Layer 1: housing thump (low resonant body).
    {
      const src = off.createBufferSource();
      src.buffer = noiseBuf;
      const bp = off.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = v.housingFreq * detune;
      bp.Q.value = v.housingQ;
      const lp = off.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 600 * detune;
      const g = off.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v.housingGain, t0 + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.housingDecay);
      src.connect(bp).connect(lp).connect(g).connect(panC).connect(masterGain);
      src.start(t0);
    }

    // Layer 2: stem thock (focused mid resonance — the dominant character).
    {
      const src = off.createBufferSource();
      src.buffer = noiseBuf;
      const bp = off.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = v.stemFreq * detune;
      bp.Q.value = v.stemQ;
      const g = off.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v.stemGain, t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.stemDecay);
      src.connect(bp).connect(g).connect(panL).connect(masterGain);
      src.start(t0);
    }

    // Layer 3: high-frequency click transient (plastic tick).
    {
      const src = off.createBufferSource();
      src.buffer = noiseBuf;
      const hp = off.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2400 * detune;
      const bp = off.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = v.clickFreq * detune;
      bp.Q.value = 1.5;
      const g = off.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v.clickGain, t0 + 0.0005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.clickDecay);
      src.connect(hp).connect(bp).connect(g).connect(panR).connect(masterGain);
      src.start(t0);
    }

    // Layer 4: bottom-out tail (sustained low rumble that decays).
    {
      const src = off.createBufferSource();
      src.buffer = noiseBuf;
      const lp = off.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = v.tailFreq * 4 * detune;
      const bp = off.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = v.tailFreq * detune;
      bp.Q.value = 2;
      const g = off.createGain();
      g.gain.setValueAtTime(0, t0 + 0.004);
      g.gain.linearRampToValueAtTime(v.tailGain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.tailDecay);
      src.connect(lp).connect(bp).connect(g).connect(panC).connect(masterGain);
      src.start(t0 + 0.004);
    }

    return off.startRendering();
  }

  private playBuffer(buf: AudioBuffer, gainMul = 1): void {
    if (!this.ctx || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.04;
    if (gainMul !== 1) {
      const g = this.ctx.createGain();
      g.gain.value = gainMul;
      src.connect(g).connect(this.master);
    } else {
      src.connect(this.master);
    }
    src.start();
  }

  play(kind: KeyKind = "normal", isUp = false): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (!isUp && now - this.lastPlayAt < THROTTLE_MS) return;
    if (!isUp) this.lastPlayAt = now;
    this.ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();

    if (this.custom) {
      this.playCustom(kind, isUp);
      return;
    }
    if (!this.rendered) {
      // First-call race: pool not ready yet. Skip silently — by next press
      // it will be ready (renderPool resolves in <30ms typically).
      return;
    }
    const pool = isUp ? this.upPool.get(kind) : this.downPool.get(kind);
    if (!pool || pool.length === 0) return;
    const buf = pool[Math.floor(Math.random() * pool.length)];
    if (buf) this.playBuffer(buf);
  }

  private playCustom(kind: KeyKind, isUp: boolean): void {
    if (!this.ctx || !this.master || !this.custom) return;
    const ctx = this.ctx;
    const c = this.custom;
    // Mechvibes packs are keyed by browser KeyboardEvent.code-ish strings.
    // For simplicity we map our `kind` to a few canonical codes and let the
    // pack pick whatever fits.
    const codeGuess =
      kind === "space"
        ? "Space"
        : kind === "enter"
          ? "Enter"
          : kind === "backspace"
            ? "Backspace"
            : "KeyA";
    const def = c.config.defines?.[codeGuess];
    if (c.spriteBuffer && Array.isArray(def)) {
      const [startMs, durMs] = def;
      const src = ctx.createBufferSource();
      src.buffer = c.spriteBuffer;
      const g = ctx.createGain();
      g.gain.value = isUp ? 0.5 : 1;
      src.connect(g).connect(this.master);
      src.start(0, startMs / 1000, durMs / 1000);
      return;
    }
    const buf = c.perKeyBuffers.get(codeGuess);
    if (buf) this.playBuffer(buf, isUp ? 0.5 : 1);
  }
}

export const keySoundEngine = new KeySoundEngine();

export function keyKindFromCode(code: string): KeyKind | null {
  if (code === "Space") return "space";
  if (code === "Enter" || code === "NumpadEnter") return "enter";
  if (code === "Backspace" || code === "Delete") return "backspace";
  if (
    code.startsWith("Shift") ||
    code.startsWith("Control") ||
    code.startsWith("Alt") ||
    code.startsWith("Meta") ||
    code === "CapsLock" ||
    code === "Tab" ||
    code === "Escape"
  ) {
    return "modifier";
  }
  if (
    code.startsWith("Arrow") ||
    code.startsWith("Page") ||
    code === "Home" ||
    code === "End" ||
    (code.startsWith("F") && /^F\d+$/.test(code)) ||
    code === "ContextMenu" ||
    code === "Insert"
  ) {
    return null;
  }
  return "normal";
}
