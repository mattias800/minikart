import type { Input } from '../input/Input';
import type { Race } from '../sim/Race';
import { cssColor, formatTime, html, ordinal } from './format';

export type ResultsChoice = 'retry' | 'menu';

/** The podium table shown after the player crosses the line. */
export class ResultsScreen {
  readonly root: HTMLElement;
  private readonly table: HTMLElement;
  private readonly heading: HTMLElement;
  private pending: ResultsChoice | null = null;

  constructor(parent: HTMLElement) {
    this.root = html(`
      <div class="screen results hidden">
        <div class="panel">
          <h2 class="results-heading"></h2>
          <ol class="results-table"></ol>
          <div class="buttons">
            <button class="retry">Race again <kbd>Enter</kbd></button>
            <button class="to-menu">Menu <kbd>Esc</kbd></button>
          </div>
        </div>
      </div>`);
    parent.appendChild(this.root);
    this.table = this.root.querySelector('.results-table') as HTMLElement;
    this.heading = this.root.querySelector('.results-heading') as HTMLElement;
    this.root.querySelector('.retry')?.addEventListener('click', () => (this.pending = 'retry'));
    this.root.querySelector('.to-menu')?.addEventListener('click', () => (this.pending = 'menu'));
  }

  show(race: Race): void {
    this.pending = null;
    this.root.classList.remove('hidden');
    this.refresh(race);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  refresh(race: Race): void {
    const player = race.player;
    const place = player?.rank ?? 1;
    this.heading.textContent = place === 1 ? 'You win! 🏆' : place <= 3 ? `${ordinal(place)} place — on the podium!` : `${ordinal(place)} place`;
    this.table.innerHTML = race.standings
      .map(
        (k) => `
        <li class="${k.isPlayer ? 'me' : ''}">
          <span class="pos">${ordinal(k.rank)}</span>
          <span class="dot" style="background:${cssColor(k.character.color)}"></span>
          <span class="name">${k.character.name}</span>
          <span class="time">${k.finished ? formatTime(k.finishTime) : 'racing…'}</span>
        </li>`,
      )
      .join('');
  }

  update(input: Input): ResultsChoice | null {
    if (input.wasPressed('confirm')) this.pending = 'retry';
    if (input.wasPressed('back')) this.pending = 'menu';
    const choice = this.pending;
    this.pending = null;
    return choice;
  }
}

export type PauseChoice = 'resume' | 'quit';

export class PauseScreen {
  readonly root: HTMLElement;
  private pending: PauseChoice | null = null;

  constructor(parent: HTMLElement) {
    this.root = html(`
      <div class="screen pause hidden">
        <div class="panel">
          <h2>Paused</h2>
          <div class="buttons">
            <button class="resume">Resume <kbd>Esc</kbd></button>
            <button class="quit">Quit to menu <kbd>Q</kbd></button>
          </div>
        </div>
      </div>`);
    parent.appendChild(this.root);
    this.root.querySelector('.resume')?.addEventListener('click', () => (this.pending = 'resume'));
    this.root.querySelector('.quit')?.addEventListener('click', () => (this.pending = 'quit'));
  }

  show(): void {
    this.pending = null;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  update(input: Input): PauseChoice | null {
    const resume = input.wasPressed('pause') || input.wasPressed('confirm');
    if (resume) this.pending = 'resume';
    // Escape is both "pause" and "back"; only treat it as quitting when it isn't resuming.
    if (input.wasKeyPressed('KeyQ') || (input.wasPressed('back') && !resume)) this.pending = 'quit';
    const choice = this.pending;
    this.pending = null;
    return choice;
  }
}
