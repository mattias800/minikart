import { clamp } from '../core/math';
import type { RaceEvent } from '../sim/events';
import type { Kart } from '../sim/Kart';
import { Music } from './Music';
import { Synth, midiToFrequency } from './Synth';

const MUTE_KEY = 'minikart.muted';

/**
 * All game audio, synthesised on the fly. Created lazily on the first user gesture,
 * since browsers refuse to start an AudioContext before one.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: Music | null = null;
  private engine: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private screech: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private muted = readMuted();
  private rouletteTimer = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a user gesture (key press or click). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    this.ctx = ctx;
    this.synth = new Synth(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const compressor = ctx.createDynamicsCompressor();
    this.master.connect(compressor).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    const musicGain = ctx.createGain();
    musicGain.gain.value = 0.55;
    musicGain.connect(this.master);
    this.music = new Music(this.synth, musicGain);
    this.createEngine(ctx);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Storage may be unavailable (private mode); muting still works for this session.
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  startMusic(): void {
    this.music?.start();
  }

  stopMusic(): void {
    this.music?.stop();
  }

  setMusicTempo(multiplier: number): void {
    this.music?.setTempo(multiplier);
  }

  /** Engine and tyre sounds for the player's kart; pass null to silence them. */
  updateKart(kart: Kart | null, dt: number): void {
    if (!this.ctx || !this.engine || !this.screech) return;
    const t = this.ctx.currentTime;
    if (!kart) {
      this.engine.gain.gain.setTargetAtTime(0, t, 0.1);
      this.screech.gain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const speed = Math.abs(kart.forwardSpeed);
    const ratio = clamp(speed / kart.stats.topSpeed, 0, 1.5);
    const revs = kart.input.throttle ? 0.15 : 0;
    const frequency = 55 + ratio * 95 + revs * 40 + (kart.boostTime > 0 ? 25 : 0);
    this.engine.osc.frequency.setTargetAtTime(frequency, t, 0.05);
    this.engine.sub.frequency.setTargetAtTime(frequency * 0.5, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(400 + ratio * 1400, t, 0.05);
    this.engine.gain.gain.setTargetAtTime(0.05 + ratio * 0.05, t, 0.05);

    const screeching = kart.driftActive && !kart.airborne;
    this.screech.gain.gain.setTargetAtTime(screeching ? 0.05 : 0, t, 0.04);
    this.screech.filter.frequency.setTargetAtTime(2200 + kart.driftLevel * 500, t, 0.05);

    if (kart.rouletteTime > 0) {
      this.rouletteTimer -= dt;
      if (this.rouletteTimer <= 0) {
        this.rouletteTimer = 0.07;
        this.blip(900 + Math.random() * 600, 0.03, 0.04, 'square');
      }
    }
  }

  countdown(): void {
    this.blip(440, 0.25, 0.15, 'square');
  }

  go(): void {
    this.blip(880, 0.6, 0.16, 'square');
    this.blip(1320, 0.6, 0.06, 'triangle');
  }

  menuMove(): void {
    this.blip(660, 0.06, 0.06, 'square');
  }

  menuSelect(): void {
    this.arpeggio([72, 76, 79, 84], 0.05, 0.08);
  }

  /** Reacts to race events. Only events involving `player` (or near them) make noise. */
  handleEvent(event: RaceEvent, player: Kart | null): void {
    if (!this.synth || !this.sfx) return;
    const synth = this.synth;
    const out = this.sfx;
    const isPlayer = 'kart' in event && event.kart === player;
    const nearby = 'kart' in event && player !== null && event.kart.position.distanceTo(player.position) < 16;
    switch (event.type) {
      case 'countdown':
        this.countdown();
        break;
      case 'go':
        this.go();
        break;
      case 'hop':
        if (isPlayer) synth.tone(out, { frequency: 300, slideTo: 520, type: 'triangle', duration: 0.1, volume: 0.08 });
        break;
      case 'driftLevel':
        if (isPlayer) synth.tone(out, { frequency: 600 + event.level * 250, type: 'triangle', duration: 0.15, volume: 0.08 });
        break;
      case 'boost':
        if (isPlayer) {
          synth.noise(out, { duration: 0.6, volume: 0.25, filter: 'bandpass', frequency: 400, sweepTo: 3000, q: 1.5 });
          synth.tone(out, { frequency: 200, slideTo: 600, type: 'sawtooth', duration: 0.35, volume: 0.05 });
        }
        break;
      case 'stall':
        if (isPlayer) synth.noise(out, { duration: 0.8, volume: 0.2, filter: 'lowpass', frequency: 500 });
        break;
      case 'itemBox':
        if (isPlayer) this.arpeggio([84, 88, 91], 0.04, 0.07);
        break;
      case 'itemGot':
        if (isPlayer) this.arpeggio([79, 84], 0.06, 0.08);
        break;
      case 'itemUsed':
        if (isPlayer && event.item !== 'mushroom' && event.item !== 'tripleMushroom') {
          synth.tone(out, { frequency: 500, slideTo: 250, type: 'square', duration: 0.12, volume: 0.07 });
        }
        if (isPlayer && event.item === 'star') this.arpeggio([72, 76, 79, 84, 88, 91, 96], 0.05, 0.07);
        break;
      case 'hit':
        if (isPlayer || nearby) {
          const volume = isPlayer ? 0.12 : 0.05;
          synth.tone(out, { frequency: 700, slideTo: 150, type: 'square', duration: 0.5, volume });
          synth.noise(out, { duration: 0.3, volume: volume * 2, filter: 'lowpass', frequency: 1200 });
        }
        break;
      case 'bump':
        if (isPlayer) synth.noise(out, { duration: 0.12, volume: clamp(event.strength / 20, 0.05, 0.25), filter: 'lowpass', frequency: 300 });
        break;
      case 'shellBreak':
        if (player && event.position.distanceTo(player.position) < 16) synth.noise(out, { duration: 0.2, volume: 0.12, filter: 'highpass', frequency: 1500 });
        break;
      case 'lap':
        if (isPlayer) this.arpeggio([72, 79, 84], 0.08, 0.1);
        break;
      case 'finish':
        if (isPlayer) this.fanfare(event.place);
        break;
    }
  }

  private fanfare(place: number): void {
    if (place <= 3) this.arpeggio([72, 76, 79, 84, 79, 84, 88], 0.11, 0.12);
    else this.arpeggio([72, 71, 69, 67], 0.18, 0.1);
  }

  private blip(frequency: number, duration: number, volume: number, type: OscillatorType): void {
    if (this.synth && this.sfx) this.synth.tone(this.sfx, { frequency, duration, volume, type });
  }

  private arpeggio(notes: number[], spacing: number, volume: number): void {
    const { synth, sfx, ctx } = this;
    if (!synth || !sfx || !ctx) return;
    const start = ctx.currentTime;
    notes.forEach((note, i) =>
      synth.tone(sfx, { frequency: midiToFrequency(note), duration: spacing * 2.5, volume, type: 'square', when: start + i * spacing }),
    );
  }

  private createEngine(ctx: AudioContext): void {
    if (!this.synth || !this.sfx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.sfx);
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain };

    const noise = this.synth.loopingNoise();
    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.Q.value = 6;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    noise.connect(screechFilter).connect(screechGain).connect(this.sfx);
    noise.start();
    this.screech = { gain: screechGain, filter: screechFilter };
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
