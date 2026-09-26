import './style.css';
import { Game } from './game/Game';

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container');
  // Canvas textures use the display font, so give it a moment to arrive (but never block on it).
  await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
  try {
    const game = new Game(container);
    game.start();
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="fatal">Mini Kart needs WebGL to run.<br><small>${String(error)}</small></div>`;
  }
  document.getElementById('loading')?.remove();
}

void boot();
