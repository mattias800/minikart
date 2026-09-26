import type { Vector3 } from 'three';
import type { ItemType } from './items';
import type { Kart } from './Kart';

export type BoostKind = 'mushroom' | 'drift' | 'start' | 'pad';

/**
 * Things that happened during a simulation step. The simulation never talks to audio, UI or
 * rendering directly; those systems drain the event queue and react however they like.
 */
export type RaceEvent =
  | { type: 'countdown'; value: number }
  | { type: 'go' }
  | { type: 'hop'; kart: Kart }
  | { type: 'driftStart'; kart: Kart }
  | { type: 'driftLevel'; kart: Kart; level: number }
  | { type: 'boost'; kart: Kart; kind: BoostKind }
  | { type: 'stall'; kart: Kart }
  | { type: 'itemBox'; kart: Kart }
  | { type: 'itemGot'; kart: Kart; item: ItemType }
  | { type: 'itemUsed'; kart: Kart; item: ItemType }
  | { type: 'hit'; kart: Kart; by: 'banana' | 'shell' | 'star' }
  | { type: 'bump'; kart: Kart; strength: number }
  | { type: 'shellBreak'; position: Vector3 }
  | { type: 'lap'; kart: Kart; lap: number }
  | { type: 'finish'; kart: Kart; place: number };

export type EventSink = (event: RaceEvent) => void;
