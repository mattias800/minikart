import { ENGINE_CLASSES, RACE, WORLD, type EngineClass } from '../config';
import { createRng } from '../core/math';
import { CHARACTERS, type Character } from './characters';
import { Race } from './Race';
import { Track } from './Track';
import { seamCurve } from './TrackLayout';
import { generateWorld, type WorldLayout } from './World';

/** The static part of a course: the road and everything placed around it. */
export interface Circuit {
  track: Track;
  world: WorldLayout;
}

export function createCircuit(): Circuit {
  const track = new Track(seamCurve, {
    radius: WORLD.planetRadius,
    halfWidth: WORLD.trackHalfWidth,
    samples: WORLD.trackSamples,
  });
  return { track, world: generateWorld(track, WORLD.seed) };
}

export interface RaceSetup {
  /** The human's character, or null for an attract-mode race with only AI. */
  playerCharacter: Character | null;
  engineClass: EngineClass;
  seed: number;
  laps?: number;
}

export function createRace(circuit: Circuit, setup: RaceSetup): Race {
  const rng = createRng(setup.seed);
  const rivals = CHARACTERS.filter((c) => c !== setup.playerCharacter);
  // Fisher–Yates shuffle so the grid is different every race.
  for (let i = rivals.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rivals[i], rivals[j]] = [rivals[j], rivals[i]];
  }
  const roster = setup.playerCharacter ? [...rivals.slice(0, RACE.racerCount - 1), setup.playerCharacter] : rivals.slice(0, RACE.racerCount);
  const engine = ENGINE_CLASSES[setup.engineClass];
  return new Race({
    track: circuit.track,
    world: circuit.world,
    roster,
    // Like the classic Grand Prix, you start at the back of the grid.
    playerIndex: setup.playerCharacter ? roster.length - 1 : -1,
    laps: setup.laps ?? RACE.laps,
    countdown: RACE.countdownSeconds,
    speedScale: engine.speedScale,
    aiSkill: engine.aiSkill,
    seed: setup.seed,
  });
}
