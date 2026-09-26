/** Small helpers for building sounds out of oscillators and noise. No audio files needed. */

export function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export interface ToneOptions {
  frequency: number;
  /** Optional glide target reached at the end of the note. */
  slideTo?: number;
  type?: OscillatorType;
  duration: number;
  volume: number;
  attack?: number;
  when?: number;
}

export interface NoiseOptions {
  duration: number;
  volume: number;
  filter: BiquadFilterType;
  frequency: number;
  q?: number;
  when?: number;
  sweepTo?: number;
}

export class Synth {
  private readonly noiseBuffer: AudioBuffer;

  constructor(readonly ctx: AudioContext) {
    const length = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  tone(destination: AudioNode, options: ToneOptions): void {
    const { ctx } = this;
    const when = options.when ?? ctx.currentTime;
    const attack = options.attack ?? 0.005;
    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'square';
    osc.frequency.setValueAtTime(options.frequency, when);
    if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, when + options.duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(options.volume, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + options.duration);
    osc.connect(gain).connect(destination);
    osc.start(when);
    osc.stop(when + options.duration + 0.05);
  }

  noise(destination: AudioNode, options: NoiseOptions): void {
    const { ctx } = this;
    const when = options.when ?? ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.frequency, when);
    if (options.sweepTo) filter.frequency.exponentialRampToValueAtTime(options.sweepTo, when + options.duration);
    filter.Q.value = options.q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(options.volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + options.duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(when, Math.random());
    source.stop(when + options.duration + 0.05);
  }

  /** A looping noise source, for continuous sounds like tyre screech. */
  loopingNoise(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }
}
