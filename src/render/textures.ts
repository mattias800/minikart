import * as THREE from 'three';
import { createRng } from '../core/math';

/** Procedurally painted canvas textures, so the game needs no image assets. */

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Asphalt with white edge lines and a dashed centre line. U runs across the road, V along it. */
export function createRoadTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (ctx) => {
    const rng = createRng(42);
    ctx.fillStyle = '#5d6270';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const shade = 80 + Math.floor(rng() * 40);
      ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 14},0.35)`;
      ctx.fillRect(rng() * 512, rng() * 512, 2, 2);
    }
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(14, 0, 12, 512);
    ctx.fillRect(512 - 26, 0, 12, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(250, 0, 12, 256);
  });
}

export function createCurbTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#e8352f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 64, 64, 64);
  });
}

export function createCheckerTexture(cellsX: number, cellsY: number): THREE.CanvasTexture {
  const cell = 32;
  return canvasTexture(cellsX * cell, cellsY * cell, (ctx) => {
    for (let x = 0; x < cellsX; x++) {
      for (let y = 0; y < cellsY; y++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#111111' : '#ffffff';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  });
}

/** Orange chevrons pointing along +V for dash panels. */
export function createBoostPadTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, '#ff7a00');
    gradient.addColorStop(1, '#ffd000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#fff6c0';
    ctx.beginPath();
    ctx.moveTo(14, 108);
    ctx.lineTo(64, 58);
    ctx.lineTo(114, 108);
    ctx.lineTo(114, 76);
    ctx.lineTo(64, 26);
    ctx.lineTo(14, 76);
    ctx.closePath();
    ctx.fill();
  });
}

/** Rainbow panel with a big question mark, for item boxes. */
export function createItemBoxTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 256, 256);
    ['#ff4d6d', '#ffb703', '#8ac926', '#1982c4', '#9b5de5'].forEach((c, i, all) => gradient.addColorStop(i / (all.length - 1), c));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, 242, 242);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(40,20,80,0.55)';
    ctx.lineWidth = 10;
    ctx.font = 'bold 190px "Lilita One", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('?', 128, 140);
    ctx.fillText('?', 128, 140);
  });
}

export function createBannerTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(1024, 128, (ctx) => {
    ctx.fillStyle = '#1b1f3b';
    ctx.fillRect(0, 0, 1024, 128);
    for (let x = 0; x < 1024; x += 32) {
      ctx.fillStyle = (x / 32) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(x, 0, 32, 16);
      ctx.fillStyle = (x / 32) % 2 === 0 ? '#111111' : '#ffffff';
      ctx.fillRect(x, 112, 32, 16);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 72px "Lilita One", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 66);
  });
}
