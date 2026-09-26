import * as THREE from 'three';
import { SIM_STEP } from '../config';
import { AudioSystem } from '../audio/AudioSystem';
import { Input } from '../input/Input';
import { CameraRig } from '../render/CameraRig';
import { ItemModels } from '../render/itemModels';
import { renderPortraits } from '../render/portraits';
import { RaceView } from '../render/RaceView';
import { Sky } from '../render/Sky';
import { WorldBend } from '../render/WorldBend';
import { WorldView } from '../render/WorldView';
import { CHARACTERS } from '../sim/characters';
import type { RaceEvent } from '../sim/events';
import type { Race } from '../sim/Race';
import { createCircuit, createRace, type Circuit } from '../sim/setup';
import { Hud } from '../ui/Hud';
import { Menu, type MenuChoice } from '../ui/Menu';
import { PauseScreen, ResultsScreen } from '../ui/Overlays';

type Mode = 'menu' | 'intro' | 'racing' | 'paused' | 'finishing' | 'results';

const MAX_STEPS_PER_FRAME = 8;
const FINISH_CELEBRATION = 3.5;
const WRONG_WAY_DELAY = 1.2;
/** How much flatter the planet looks while racing (see WorldBend). */
const RACING_BEND = 7;

const tmpDir = new THREE.Vector3();
const tmpSide = new THREE.Vector3();
const tmpFocus = new THREE.Vector3();

/** Owns the renderer, the current race and all the screens, and runs the main loop. */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly sky = new Sky();
  private readonly sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  private readonly hemisphere = new THREE.HemisphereLight(0xcfeaff, 0x4d7a35, 1.3);
  private readonly circuit: Circuit;
  private readonly bend: WorldBend;
  private readonly worldView: WorldView;
  private readonly itemModels = new ItemModels();
  private readonly input = new Input(window);
  private readonly audio = new AudioSystem();
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly results: ResultsScreen;
  private readonly pause: PauseScreen;

  private race: Race;
  private raceView: RaceView;
  private mode: Mode = 'menu';
  private modeTime = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private lastChoice: MenuChoice | null = null;
  private wrongWayTime = 0;
  private resultsRefresh = 0;
  private seed = Date.now() % 100000;
  private readonly autopilot = new URLSearchParams(window.location.search).has('autopilot');

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.circuit = createCircuit();
    this.bend = new WorldBend(this.circuit.track.radius);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight, this.circuit.track.radius, this.bend);
    this.worldView = new WorldView(this.circuit);
    this.scene.add(this.sky.mesh, this.worldView.group, this.hemisphere, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;

    const ui = document.createElement('div');
    ui.className = 'ui';
    container.appendChild(ui);
    this.hud = new Hud(ui);
    this.menu = new Menu(ui, renderPortraits(CHARACTERS), { move: () => this.audio.menuMove(), select: () => this.audio.menuSelect() });
    this.results = new ResultsScreen(ui);
    this.pause = new PauseScreen(ui);

    this.input.onAnyInput = () => {
      this.audio.unlock();
      this.audio.startMusic();
    };
    window.addEventListener('resize', () => this.resize());

    this.race = this.createAttractRace();
    this.raceView = this.attachRaceView(this.race);
    this.enterMenu();
    this.resize();
  }

  start(): void {
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;
    this.modeTime += dt;
    this.input.poll();
    if (this.input.wasPressed('mute')) this.audio.toggleMute();

    this.updateMode(dt);
    this.updateBend();
    this.updateViews(dt);
    this.bend.apply(this.scene);
    this.renderer.render(this.scene, this.rig.camera);
    this.input.endFrame();
  }

  private updateMode(dt: number): void {
    const player = this.race.player;
    switch (this.mode) {
      case 'menu': {
        this.simulate(dt);
        const choice = this.menu.update(this.input);
        if (choice) this.startRace(choice);
        break;
      }
      case 'intro':
        if (this.rig.introFinished) {
          this.rig.setMode('chase');
          this.setMode('racing');
        }
        break;
      case 'racing':
        if (this.input.wasPressed('pause')) {
          this.setMode('paused');
          this.pause.show();
          break;
        }
        if (player && !this.autopilot) this.input.readKart(player.input);
        this.simulate(dt);
        this.updateWrongWay(dt);
        break;
      case 'paused': {
        const choice = this.pause.update(this.input);
        if (choice === 'resume') {
          this.pause.hide();
          this.setMode('racing');
        } else if (choice === 'quit') {
          this.pause.hide();
          this.enterMenu();
        }
        break;
      }
      case 'finishing':
        this.simulate(dt);
        if (this.modeTime > FINISH_CELEBRATION) {
          this.setMode('results');
          this.results.show(this.race);
          this.hud.hide();
        }
        break;
      case 'results': {
        this.simulate(dt);
        this.resultsRefresh -= dt;
        if (this.resultsRefresh <= 0) {
          this.resultsRefresh = 0.5;
          this.results.refresh(this.race);
        }
        const choice = this.results.update(this.input);
        if (choice === 'retry' && this.lastChoice) this.startRace(this.lastChoice);
        else if (choice === 'menu') this.enterMenu();
        break;
      }
    }
  }

  /** Advances the simulation in fixed steps and dispatches what happened. */
  private simulate(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, SIM_STEP * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= SIM_STEP) {
      this.race.step(SIM_STEP);
      this.accumulator -= SIM_STEP;
    }
    for (const event of this.race.drainEvents()) this.handleEvent(event);
  }

  private handleEvent(event: RaceEvent): void {
    this.raceView.handleEvent(event);
    const player = this.race.player;
    if (!player) return; // attract mode: no sound or messages
    this.audio.handleEvent(event, player);
    const mine = 'kart' in event && event.kart === player;
    switch (event.type) {
      case 'countdown':
        this.hud.flash(String(event.value), 'countdown', 0.9);
        break;
      case 'go':
        this.hud.flash('GO!', 'go', 1);
        break;
      case 'lap':
        if (!mine) break;
        if (event.lap === this.race.laps) {
          this.hud.flash('FINAL LAP!', 'final', 2);
          this.audio.setMusicTempo(1.12);
        } else {
          this.hud.flash(`LAP ${event.lap}`, 'lap', 1.4);
        }
        break;
      case 'finish':
        if (!mine) break;
        this.hud.flash('FINISH!', 'finish', FINISH_CELEBRATION);
        this.setMode('finishing');
        this.rig.setMode('finish');
        this.audio.setMusicTempo(1);
        break;
      case 'boost':
        if (mine && event.kind === 'start') this.hud.flash('ROCKET START!', 'small', 1.2);
        break;
      case 'stall':
        if (mine) this.hud.flash('Too early!', 'small', 1.2);
        break;
      case 'hit':
        if (mine) this.rig.addShake(0.8);
        break;
      case 'bump':
        if (mine) this.rig.addShake(Math.min(0.4, event.strength / 30));
        break;
      default:
        break;
    }
  }

  /** Tiny planet in the menu; unrolled around the player while racing, blending in during the fly-in. */
  private updateBend(): void {
    const player = this.race.player;
    if (!player || this.mode === 'menu') {
      this.bend.factor = 1;
      return;
    }
    const t = this.rig.introProgress;
    this.bend.factor = 1 + (RACING_BEND - 1) * t * t;
    this.bend.anchor.copy(player.up);
  }

  private updateViews(dt: number): void {
    const player = this.race.player;
    const racing = this.mode === 'racing' || this.mode === 'intro';
    if (this.mode !== 'paused') {
      this.worldView.update(dt, this.elapsed);
      this.raceView.update(dt);
      this.rig.update(dt, player, racing && player !== null && player.input.lookBack);
      this.raceView.setPixelScale(this.renderer.domElement.height, this.rig.camera.fov);
    }
    this.updateLighting();
    if (player && this.mode !== 'menu' && this.mode !== 'results') this.hud.update(this.race, dt, this.wrongWayTime > WRONG_WAY_DELAY);
    this.audio.updateKart(this.mode === 'racing' || this.mode === 'finishing' ? player : null, dt);
  }

  /**
   * On a planet this small a fixed sun would leave half the track in darkness, so the sun
   * hangs over whatever the camera is looking at, slightly off to one side for nice shadows.
   */
  private updateLighting(): void {
    const camera = this.rig.camera;
    const anchor = tmpDir.copy(camera.position).normalize();
    tmpSide.set(0, 1, 0).cross(anchor);
    if (tmpSide.lengthSq() < 1e-4) tmpSide.set(1, 0, 0);
    tmpSide.normalize();
    const sunDirection = tmpSide.multiplyScalar(0.45).add(anchor).normalize();

    const player = this.race.player;
    const close = this.mode !== 'menu' && player !== null;
    const focus = close ? tmpFocus.copy(player.position) : tmpFocus.copy(anchor).multiplyScalar(this.circuit.track.radius);
    const extent = close ? 26 : this.circuit.track.radius * 1.3;
    const shadowCamera = this.sun.shadow.camera;
    if (shadowCamera.right !== extent) {
      shadowCamera.left = -extent;
      shadowCamera.right = extent;
      shadowCamera.top = extent;
      shadowCamera.bottom = -extent;
      shadowCamera.near = 1;
      shadowCamera.far = close ? 140 : 260;
      shadowCamera.updateProjectionMatrix();
    }
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(sunDirection, close ? 60 : 120);
    this.hemisphere.position.copy(anchor);
    this.sky.update(camera, camera.up, sunDirection);
  }

  private updateWrongWay(dt: number): void {
    const player = this.race.player;
    if (!player || this.race.phase !== 'racing') {
      this.wrongWayTime = 0;
      return;
    }
    const tangent = this.circuit.track.tangents[player.trackIndex];
    const backwards = player.velocity.dot(tangent) < -2 || (player.forward.dot(tangent) < -0.3 && Math.abs(player.forwardSpeed) < 2);
    this.wrongWayTime = backwards ? this.wrongWayTime + dt : 0;
  }

  private startRace(choice: MenuChoice): void {
    this.lastChoice = choice;
    this.replaceRace(createRace(this.circuit, { playerCharacter: choice.character, engineClass: choice.engineClass, seed: this.nextSeed() }));
    this.race.autopilot = this.autopilot;
    this.menu.hide();
    this.results.hide();
    this.hud.show(this.race);
    this.audio.setMusicTempo(1);
    this.wrongWayTime = 0;
    this.setMode('intro');
    this.rig.setMode('intro');
  }

  private enterMenu(): void {
    if (this.race.player) this.replaceRace(this.createAttractRace());
    this.hud.hide();
    this.results.hide();
    this.menu.show();
    this.audio.setMusicTempo(1);
    this.setMode('menu');
    this.rig.setMode('orbit');
  }

  private createAttractRace(): Race {
    return createRace(this.circuit, { playerCharacter: null, engineClass: '100cc', seed: this.nextSeed(), laps: 999 });
  }

  private replaceRace(race: Race): void {
    this.raceView.dispose();
    this.race = race;
    this.raceView = this.attachRaceView(race);
    this.accumulator = 0;
  }

  private attachRaceView(race: Race): RaceView {
    const view = new RaceView(race, this.worldView, this.itemModels);
    view.setPixelScale(this.renderer.domElement.height, this.rig.camera.fov);
    this.scene.add(view.group);
    return view;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeTime = 0;
    this.applyFraming();
  }

  /** On wide screens the menu sits on the right, so shift the planet into the space on the left. */
  private applyFraming(): void {
    const camera = this.rig.camera;
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (this.mode === 'menu' && width > 900) camera.setViewOffset(width, height, width * 0.26, 0, width, height);
    else camera.clearViewOffset();
  }

  private nextSeed(): number {
    this.seed = (this.seed * 16807 + 11) % 2147483647;
    return this.seed;
  }

  private resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.rig.camera.aspect = width / height;
    this.rig.camera.updateProjectionMatrix();
    this.applyFraming();
    this.raceView.setPixelScale(this.renderer.domElement.height, this.rig.camera.fov);
  }
}
