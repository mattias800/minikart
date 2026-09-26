import { describe, expect, it } from 'vitest';
import { SIM_STEP } from '../config';
import { CHARACTERS } from './characters';
import type { RaceEvent } from './events';
import { createCircuit, createRace } from './setup';

const circuit = createCircuit();

function simulate(seconds: number, race = createRace(circuit, { playerCharacter: null, engineClass: '100cc', seed: 1 })) {
  const events: RaceEvent[] = [];
  let offroadSteps = 0;
  let steps = 0;
  for (let t = 0; t < seconds && race.phase !== 'finished'; t += SIM_STEP) {
    race.step(SIM_STEP);
    events.push(...race.drainEvents());
    if (race.phase === 'racing') {
      steps++;
      offroadSteps += race.karts.filter((k) => k.offroad).length;
    }
  }
  return { race, events, offroadShare: offroadSteps / Math.max(1, steps * race.karts.length) };
}

describe('Race', () => {
  it('counts down before the green light', () => {
    const { events } = simulate(3.5);
    const countdown = events.filter((e) => e.type === 'countdown').map((e) => (e as { value: number }).value);
    expect(countdown).toEqual([3, 2, 1]);
    expect(events.some((e) => e.type === 'go')).toBe(true);
  });

  it('lets AI drivers finish every lap, using items and drifts along the way', () => {
    const { race, events, offroadShare } = simulate(400);
    const times = race.standings.map((k) => `${k.character.name} ${k.finishTime.toFixed(1)}s`);
    console.log(`finish: ${times.join(', ')} | offroad ${(offroadShare * 100).toFixed(1)}%`);
    const count = (type: RaceEvent['type']) => events.filter((e) => e.type === type).length;
    console.log(`drifts ${count('driftStart')} boosts ${count('boost')} items ${count('itemUsed')} hits ${count('hit')} bumps ${count('bump')}`);
    expect(race.karts.every((k) => k.finished)).toBe(true);
    expect(count('itemUsed')).toBeGreaterThan(10);
    expect(count('driftStart')).toBeGreaterThan(10);
    expect(offroadShare).toBeLessThan(0.1);
  });

  it('puts the player at the back of the grid', () => {
    const race = createRace(circuit, { playerCharacter: CHARACTERS[0], engineClass: '100cc', seed: 2 });
    expect(race.player?.rank).toBe(race.karts.length);
  });
});
