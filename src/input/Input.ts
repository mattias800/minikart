import type { KartInput } from '../sim/Kart';

/** Abstract actions, so menus and driving don't care whether you use a keyboard or a pad. */
export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'mute';

const KEY_BINDINGS: Record<string, readonly string[]> = {
  accelerate: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyX', 'ControlLeft', 'ControlRight'],
  lookBack: ['KeyC'],
};

const ACTION_KEYS: Record<Action, readonly string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
};

// Standard gamepad mapping indices.
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

const ACTION_BUTTONS: Record<Action, readonly number[]> = {
  up: [PAD.up],
  down: [PAD.down],
  left: [PAD.left],
  right: [PAD.right],
  confirm: [PAD.a, PAD.start],
  back: [PAD.b],
  pause: [PAD.start],
  mute: [],
};

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private buttons: boolean[] = [];
  private previousButtons: boolean[] = [];
  private stickX = 0;
  private stickY = 0;
  private previousStickX = 0;
  private previousStickY = 0;
  /** Fires on any key or button, e.g. to unlock audio. */
  onAnyInput: (() => void) | null = null;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.onAnyInput?.();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointerdown', () => this.onAnyInput?.());
  }

  /** Call once per frame before reading input. */
  poll(): void {
    this.previousButtons = this.buttons;
    this.previousStickX = this.stickX;
    this.previousStickY = this.stickY;
    const pad = navigator.getGamepads?.().find((p) => p?.connected) ?? null;
    if (!pad) {
      this.buttons = [];
      this.stickX = this.stickY = 0;
      return;
    }
    this.buttons = pad.buttons.map((b) => b.pressed);
    this.stickX = deadzone(pad.axes[0] ?? 0);
    this.stickY = deadzone(pad.axes[1] ?? 0);
    if (this.buttons.some((b, i) => b && !this.previousButtons[i])) this.onAnyInput?.();
  }

  /** Call once per frame after handling input. */
  endFrame(): void {
    this.pressed.clear();
  }

  wasKeyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasPressed(action: Action): boolean {
    if (ACTION_KEYS[action].some((k) => this.pressed.has(k))) return true;
    if (ACTION_BUTTONS[action].some((b) => this.buttons[b] && !this.previousButtons[b])) return true;
    // Treat a flick of the stick as a menu press.
    const flick = (now: number, before: number, sign: number) => now * sign > 0.6 && before * sign <= 0.6;
    switch (action) {
      case 'left':
        return flick(this.stickX, this.previousStickX, -1);
      case 'right':
        return flick(this.stickX, this.previousStickX, 1);
      case 'up':
        return flick(this.stickY, this.previousStickY, -1);
      case 'down':
        return flick(this.stickY, this.previousStickY, 1);
      default:
        return false;
    }
  }

  readKart(out: KartInput): KartInput {
    const key = (name: string) => KEY_BINDINGS[name].some((k) => this.down.has(k));
    const button = (...indices: number[]) => indices.some((i) => this.buttons[i]);
    let steer = (key('right') ? 1 : 0) - (key('left') ? 1 : 0);
    if (button(PAD.left)) steer -= 1;
    if (button(PAD.right)) steer += 1;
    if (Math.abs(this.stickX) > Math.abs(steer)) steer = this.stickX;
    out.steer = Math.max(-1, Math.min(1, steer));
    out.throttle = key('accelerate') || button(PAD.a, PAD.rt);
    out.brake = key('brake') || button(PAD.b, PAD.lt) || this.stickY > 0.7;
    out.drift = key('drift') || button(PAD.rb);
    out.useItem = key('item') || button(PAD.lb, PAD.x);
    out.lookBack = key('lookBack') || button(PAD.y);
    return out;
  }
}

function deadzone(value: number): number {
  return Math.abs(value) < 0.18 ? 0 : value;
}
