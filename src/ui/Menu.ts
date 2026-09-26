import type { EngineClass } from '../config';
import type { Input } from '../input/Input';
import { CHARACTERS, type Character } from '../sim/characters';
import { cssColor, html } from './format';

export interface MenuChoice {
  character: Character;
  engineClass: EngineClass;
}

export interface MenuSounds {
  move(): void;
  select(): void;
}

const ENGINE_CLASSES: readonly EngineClass[] = ['50cc', '100cc', '150cc'];
const COLUMNS = 4;
const STAT_LABELS = [
  ['speed', 'Speed'],
  ['acceleration', 'Accel'],
  ['handling', 'Handling'],
  ['weight', 'Weight'],
] as const;

/** Title screen with character and engine-class select. */
export class Menu {
  readonly root: HTMLElement;
  private selected = 0;
  private engine = 1;
  private pendingStart = false;
  private readonly cards: HTMLElement[];
  private readonly engineButtons: HTMLElement[];
  private readonly details: HTMLElement;

  constructor(
    parent: HTMLElement,
    portraits: ReadonlyMap<string, string>,
    private readonly sounds: MenuSounds,
  ) {
    this.root = html(`
      <div class="screen menu hidden">
        <header class="title">
          <h1><span class="mini">Mini</span><span class="kart">Kart</span></h1>
          <p class="tagline">The World's Smallest Grand Prix</p>
        </header>
        <section class="panel">
          <h2>Choose your racer</h2>
          <div class="roster">
            ${CHARACTERS.map(
              (c, i) => `
              <button class="card" data-index="${i}" style="--c:${cssColor(c.color)}">
                <img alt="" src="${portraits.get(c.id) ?? ''}"/>
                <span class="card-name">${c.name}</span>
              </button>`,
            ).join('')}
          </div>
          <div class="details"></div>
          <div class="engine">
            ${ENGINE_CLASSES.map((e, i) => `<button class="engine-btn" data-index="${i}">${e}</button>`).join('')}
          </div>
          <button class="start-btn">Start race</button>
          <p class="hint">←→↑↓ choose · 1 2 3 engine class · Enter start · M mute</p>
        </section>
        <footer class="controls">
          <div><kbd>↑</kbd><kbd>W</kbd> accelerate</div>
          <div><kbd>←</kbd><kbd>→</kbd> steer</div>
          <div><kbd>↓</kbd><kbd>S</kbd> brake / reverse</div>
          <div><kbd>Space</kbd> hop &amp; drift, hold for a mini-turbo</div>
          <div><kbd>E</kbd> use item (hold <kbd>↓</kbd> to throw back)</div>
          <div><kbd>C</kbd> look back · 🎮 gamepads work too</div>
        </footer>
      </div>`);
    parent.appendChild(this.root);
    this.cards = [...this.root.querySelectorAll<HTMLElement>('.card')];
    this.engineButtons = [...this.root.querySelectorAll<HTMLElement>('.engine-btn')];
    this.details = this.root.querySelector('.details') as HTMLElement;

    this.cards.forEach((card, i) =>
      card.addEventListener('click', () => {
        if (this.selected === i) this.pendingStart = true;
        this.select(i);
      }),
    );
    this.engineButtons.forEach((button, i) => button.addEventListener('click', () => this.setEngine(i)));
    this.root.querySelector('.start-btn')?.addEventListener('click', () => (this.pendingStart = true));
    this.render();
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.pendingStart = false;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Returns the player's choice once they start a race. */
  update(input: Input): MenuChoice | null {
    if (input.wasPressed('left')) this.select((this.selected + CHARACTERS.length - 1) % CHARACTERS.length);
    if (input.wasPressed('right')) this.select((this.selected + 1) % CHARACTERS.length);
    if (input.wasPressed('up')) this.select((this.selected + CHARACTERS.length - COLUMNS) % CHARACTERS.length);
    if (input.wasPressed('down')) this.select((this.selected + COLUMNS) % CHARACTERS.length);
    ['Digit1', 'Digit2', 'Digit3'].forEach((code, i) => input.wasKeyPressed(code) && this.setEngine(i));
    if (input.wasPressed('confirm')) this.pendingStart = true;
    if (!this.pendingStart) return null;
    this.pendingStart = false;
    this.sounds.select();
    return { character: CHARACTERS[this.selected], engineClass: ENGINE_CLASSES[this.engine] };
  }

  private select(index: number): void {
    if (index !== this.selected) this.sounds.move();
    this.selected = index;
    this.render();
  }

  private setEngine(index: number): void {
    if (index !== this.engine) this.sounds.move();
    this.engine = index;
    this.render();
  }

  private render(): void {
    this.cards.forEach((card, i) => card.classList.toggle('selected', i === this.selected));
    this.engineButtons.forEach((button, i) => button.classList.toggle('selected', i === this.engine));
    const c = CHARACTERS[this.selected];
    this.details.innerHTML = `
      <div class="details-name" style="color:${cssColor(c.color)}">${c.name}</div>
      ${STAT_LABELS.map(
        ([key, label]) => `
        <div class="stat"><span>${label}</span><div class="bar"><i style="width:${c.stats[key] * 20}%;background:${cssColor(c.color)}"></i></div></div>`,
      ).join('')}`;
  }
}
