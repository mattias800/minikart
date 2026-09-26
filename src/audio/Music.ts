import { midiToFrequency, type Synth } from './Synth';

/** A 16th-note step: a MIDI note, or null for a rest. */
type Step = number | null;
const _ = null;

// An upbeat eight-bar loop in C major: I–vi–IV–V, then IV–V–iii–vi with a turnaround.
const LEAD: Step[] = [
  76, _, 79, _, 84, _, 79, _, 81, 79, 76, _, 74, _, 72, _,
  72, _, 76, _, 81, _, 76, _, 79, 76, 74, _, 72, _, 69, _,
  77, _, 81, _, 84, _, 81, _, 79, 77, 76, _, 77, _, 79, _,
  79, _, 83, _, 86, _, 83, _, 81, _, 79, _, 74, 76, 77, 79,
  81, _, 77, _, 72, _, 77, 81, 84, _, 81, _, 77, _, 81, _,
  83, _, 79, _, 74, _, 79, 83, 86, _, 83, _, 79, _, 74, _,
  83, _, 79, _, 76, _, 79, _, 81, _, 76, _, 72, _, 76, _,
  81, 79, 76, 72, 74, 76, 77, 79, 81, _, 83, _, 84, _, _, _,
];

const CHORD_ROOTS = [48, 45, 41, 43, 41, 43, 40, 45];

/** Loops a chiptune track using Web Audio's clock with a short look-ahead scheduler. */
export class Music {
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private tempo = 1;
  private readonly bpm = 148;

  constructor(
    private readonly synth: Synth,
    private readonly output: AudioNode,
  ) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.tempo = 1;
    this.nextTime = this.synth.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Speeds the music up, classic final-lap style. */
  setTempo(multiplier: number): void {
    this.tempo = multiplier;
  }

  private schedule(): void {
    const ctx = this.synth.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / (this.bpm * this.tempo) / 4;
      this.step = (this.step + 1) % LEAD.length;
    }
  }

  private playStep(step: number, when: number): void {
    const synth = this.synth;
    const out = this.output;
    const stepLength = 60 / (this.bpm * this.tempo) / 4;
    const beat = step % 16;
    const bar = Math.floor(step / 16);

    const note = LEAD[step];
    if (note !== null) {
      synth.tone(out, { frequency: midiToFrequency(note), type: 'square', duration: stepLength * 1.7, volume: 0.045, when });
      synth.tone(out, { frequency: midiToFrequency(note + 12), type: 'triangle', duration: stepLength * 1.2, volume: 0.02, when });
    }

    if (beat % 2 === 0) {
      const root = CHORD_ROOTS[bar];
      const pattern = [0, 12, 7, 12];
      synth.tone(out, { frequency: midiToFrequency(root + pattern[(beat / 2) % 4]), type: 'triangle', duration: stepLength * 1.8, volume: 0.16, when });
    }

    // Arpeggiated chord on the off-beats.
    if (beat % 4 === 2) {
      const root = CHORD_ROOTS[bar] + 24;
      const minor = bar === 1 || bar === 6 || bar === 7;
      const third = minor ? 3 : 4;
      [0, third, 7].forEach((interval, i) =>
        synth.tone(out, { frequency: midiToFrequency(root + interval), type: 'square', duration: stepLength * 0.8, volume: 0.012, when: when + i * stepLength * 0.33 }),
      );
    }

    if (beat % 4 === 0) {
      synth.tone(out, { frequency: 150, slideTo: 40, type: 'sine', duration: 0.14, volume: 0.35, when });
    }
    if (beat === 4 || beat === 12) {
      synth.noise(out, { duration: 0.12, volume: 0.12, filter: 'bandpass', frequency: 1800, q: 0.8, when });
      synth.tone(out, { frequency: 190, slideTo: 120, type: 'triangle', duration: 0.08, volume: 0.08, when });
    }
    if (beat % 2 === 1) {
      synth.noise(out, { duration: 0.03, volume: 0.05, filter: 'highpass', frequency: 7000, when });
    }
  }
}
