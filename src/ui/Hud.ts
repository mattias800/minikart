import { ALL_ITEMS } from '../sim/items';
import type { Race } from '../sim/Race';
import { cssColor, formatTime, html, ordinalSuffix } from './format';
import { itemIcon } from './icons';

const RING_RADIUS = 44;

/** The in-race overlay: item slot, standings, lap counter, timer, position and big messages. */
export class Hud {
  readonly root: HTMLElement;
  private readonly itemSlot: HTMLElement;
  private readonly itemCount: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly position: HTMLElement;
  private readonly standings: HTMLElement;
  private readonly ring: SVGElement;
  private readonly message: HTMLElement;
  private readonly wrongWay: HTMLElement;
  private messageTimer = 0;
  private lastItemKey = '';
  private lastRank = 0;
  private rouletteIndex = 0;
  private rouletteClock = 0;

  constructor(parent: HTMLElement) {
    this.root = html(`
      <div class="hud hidden">
        <div class="hud-item"><div class="item-slot"></div><div class="item-count"></div></div>
        <ol class="standings"></ol>
        <div class="hud-lap"><div class="lap"></div><div class="timer"></div></div>
        <div class="hud-position"></div>
        <svg class="hud-ring" viewBox="-60 -60 120 120"></svg>
        <div class="hud-message"></div>
        <div class="hud-wrong-way">WRONG WAY!</div>
        <div class="hud-help">Space drift · E item · ↓+E throw back · C look back · Esc pause</div>
      </div>`);
    parent.appendChild(this.root);
    const q = <T extends Element = HTMLElement>(selector: string) => this.root.querySelector(selector) as T;
    this.itemSlot = q('.item-slot');
    this.itemCount = q('.item-count');
    this.lap = q('.lap');
    this.timer = q('.timer');
    this.position = q('.hud-position');
    this.standings = q('.standings');
    this.ring = q<SVGElement>('.hud-ring');
    this.message = q('.hud-message');
    this.wrongWay = q('.hud-wrong-way');
  }

  show(race: Race): void {
    this.root.classList.remove('hidden');
    this.lastItemKey = '';
    this.lastRank = 0;
    this.message.className = 'hud-message';
    this.buildRing(race);
    this.buildStandings(race);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  flash(text: string, style = '', seconds = 1.4): void {
    this.message.textContent = text;
    this.message.className = `hud-message show ${style}`;
    this.messageTimer = seconds;
  }

  update(race: Race, dt: number, wrongWay: boolean): void {
    const player = race.player;
    if (!player) return;
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.classList.remove('show');
    }

    this.lap.innerHTML = `<span>LAP</span> ${Math.min(race.laps, player.lapsCompleted + 1)}<small>/${race.laps}</small>`;
    this.timer.textContent = formatTime(player.finished ? player.finishTime : race.time);

    if (player.rank !== this.lastRank) {
      this.lastRank = player.rank;
      this.position.innerHTML = `${player.rank}<small>${ordinalSuffix(player.rank)}</small>`;
      this.position.dataset.rank = String(player.rank);
      this.position.classList.remove('pop');
      void this.position.offsetWidth; // restart the CSS animation
      this.position.classList.add('pop');
    }

    this.updateItemSlot(race, dt);
    this.updateStandings(race);
    this.updateRing(race);
    this.wrongWay.classList.toggle('show', wrongWay);
  }

  private updateItemSlot(race: Race, dt: number): void {
    const player = race.player!;
    let key: string;
    if (player.rouletteTime > 0) {
      this.rouletteClock -= dt;
      if (this.rouletteClock <= 0) {
        this.rouletteClock = 0.07;
        this.rouletteIndex = (this.rouletteIndex + 1) % ALL_ITEMS.length;
      }
      key = `roulette-${this.rouletteIndex}`;
      if (key !== this.lastItemKey) this.itemSlot.innerHTML = itemIcon(ALL_ITEMS[this.rouletteIndex]);
      this.itemSlot.classList.add('rolling');
    } else {
      key = player.item ? `${player.item}-${player.itemCount}` : 'empty';
      if (key !== this.lastItemKey) {
        this.itemSlot.innerHTML = player.item ? itemIcon(player.item) : '';
        this.itemCount.textContent = player.item && player.itemCount > 1 ? `×${player.itemCount}` : '';
      }
      this.itemSlot.classList.remove('rolling');
    }
    this.lastItemKey = key;
  }

  private buildStandings(race: Race): void {
    this.standings.innerHTML = race.karts
      .map(
        (k) => `<li data-id="${k.id}" class="${k.isPlayer ? 'me' : ''}">
          <span class="pos"></span><span class="dot" style="background:${cssColor(k.character.color)}"></span><span class="name">${k.character.name}</span>
        </li>`,
      )
      .join('');
  }

  private updateStandings(race: Race): void {
    const rowHeight = 26;
    for (const kart of race.karts) {
      const row = this.standings.querySelector<HTMLElement>(`li[data-id="${kart.id}"]`);
      if (!row) continue;
      row.style.transform = `translateY(${(kart.rank - 1) * rowHeight}px)`;
      (row.firstElementChild as HTMLElement).textContent = String(kart.rank);
      row.classList.toggle('done', kart.finished);
    }
  }

  private buildRing(race: Race): void {
    const dots = race.karts
      .map((k) => `<circle data-id="${k.id}" r="${k.isPlayer ? 7 : 5}" fill="${cssColor(k.character.color)}" class="${k.isPlayer ? 'me' : ''}"/>`)
      .join('');
    this.ring.innerHTML = `
      <circle r="${RING_RADIUS}" class="ring-track"/>
      <line x1="0" y1="${-RING_RADIUS - 8}" x2="0" y2="${-RING_RADIUS + 8}" class="ring-start"/>
      ${dots}`;
  }

  /** A lap-progress ring: every racer is a dot, going clockwise from the start line at the top. */
  private updateRing(race: Race): void {
    for (const kart of race.karts) {
      const dot = this.ring.querySelector<SVGCircleElement>(`circle[data-id="${kart.id}"]`);
      if (!dot) continue;
      const angle = (kart.trackS / race.track.length) * Math.PI * 2 - Math.PI / 2;
      dot.setAttribute('cx', (Math.cos(angle) * RING_RADIUS).toFixed(2));
      dot.setAttribute('cy', (Math.sin(angle) * RING_RADIUS).toFixed(2));
    }
    // Keep the player's dot on top.
    const mine = this.ring.querySelector('circle.me');
    if (mine && mine !== this.ring.lastElementChild) this.ring.appendChild(mine);
  }
}
