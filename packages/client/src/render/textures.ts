import * as THREE from 'three';
import { mulberry32 } from '@mazmorra/shared';

/**
 * Texturas procedurales de baja resolución (64x64 o menos, filtrado nearest, sin mipmaps),
 * para no depender de assets mientras no haya arte (DECISIONES: D-07).
 */
function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, mulberry32(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, rnd: () => number, size: number, base: [number, number, number], amp: number) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rnd() - 0.5) * amp;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function createTextures() {
  const floor = canvasTexture(64, (ctx, rnd) => {
    noise(ctx, rnd, 64, [78, 72, 66], 40);
    ctx.fillStyle = 'rgba(20,16,14,0.9)';
    for (let i = 0; i <= 64; i += 32) {
      ctx.fillRect(i - 1, 0, 2, 64);
      ctx.fillRect(0, i - 1, 64, 2);
    }
    // Grietas y musgo.
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(30,26,22,0.8)' : 'rgba(46,60,34,0.6)';
      let x = rnd() * 64;
      let y = rnd() * 64;
      for (let s = 0; s < 10; s++) {
        ctx.fillRect(Math.floor(x), Math.floor(y), 2, 1);
        x += (rnd() - 0.5) * 6;
        y += (rnd() - 0.5) * 6;
      }
    }
  }, 11);

  const wall = canvasTexture(64, (ctx, rnd) => {
    noise(ctx, rnd, 64, [70, 64, 70], 30);
    ctx.fillStyle = 'rgba(18,14,18,0.95)';
    for (let row = 0; row < 8; row++) {
      ctx.fillRect(0, row * 8, 64, 1);
      const off = row % 2 === 0 ? 0 : 8;
      for (let x = off; x < 64; x += 16) ctx.fillRect(x, row * 8, 1, 8);
    }
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '40,52,30' : '24,20,24'},0.5)`;
      ctx.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 2, 2);
    }
  }, 23);

  const grain = canvasTexture(32, (ctx, rnd) => {
    noise(ctx, rnd, 32, [210, 210, 210], 60);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let y = 0; y < 32; y += 4) ctx.fillRect(0, y, 32, 1);
  }, 5);

  const wood = canvasTexture(32, (ctx, rnd) => {
    noise(ctx, rnd, 32, [110, 76, 46], 30);
    ctx.fillStyle = 'rgba(50,30,16,0.7)';
    for (let x = 0; x < 32; x += 3 + Math.floor(rnd() * 3)) ctx.fillRect(x, 0, 1, 32);
  }, 7);

  const sarcophagus = canvasTexture(64, (ctx, rnd) => {
    noise(ctx, rnd, 64, [96, 92, 84], 26);
    ctx.strokeStyle = 'rgba(30,26,22,0.9)';
    ctx.strokeRect(4.5, 4.5, 55, 55);
    ctx.strokeRect(10.5, 10.5, 43, 43);
    ctx.fillStyle = 'rgba(30,26,22,0.9)';
    ctx.fillRect(30, 14, 4, 36);
    ctx.fillRect(20, 24, 24, 4);
  }, 31);

  return { floor, wall, grain, wood, sarcophagus };
}

export type Textures = ReturnType<typeof createTextures>;
