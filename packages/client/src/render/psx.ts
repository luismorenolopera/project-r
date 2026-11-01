import * as THREE from 'three';

/**
 * Sombreado estilo PS1 (7.3):
 * - Vertex snapping: los vértices se ajustan a una rejilla de baja resolución en espacio de pantalla.
 * - Mapeado afín: las texturas se interpolan sin corrección de perspectiva (el "baile" de texturas).
 * - Post-proceso: render a baja resolución, cuantización a 15 bits por píxel con dithering Bayer 4x4.
 */
export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(160, 120) },
};

export function psxify<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = psxUniforms.uSnap;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec2 uSnap;
varying vec2 vAffUv;
varying float vAffW;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 snapped = gl_Position;
  snapped.xyz /= snapped.w;
  snapped.xy = floor(snapped.xy * uSnap + 0.5) / uSnap;
  snapped.xyz *= snapped.w;
  gl_Position = snapped;
}
#ifdef USE_MAP
  vAffUv = vMapUv * gl_Position.w;
  vAffW = gl_Position.w;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vAffUv;
varying float vAffW;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vAffUv / vAffW );
  diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'psx';
  return material;
}

export function psxLambert(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  return psxify(new THREE.MeshLambertMaterial({ flatShading: true, ...params }));
}

/** Render a baja resolución + dithering y cuantización de color. */
export class RetroPostProcess {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  /** Altura interna en píxeles (la PS1 solía usar 240). */
  internalHeight = 270;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(320, 240) },
        uLevels: { value: 32 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uRes;
        uniform float uLevels;
        varying vec2 vUv;
        float bayer(vec2 p){
          int x = int(mod(p.x, 4.0));
          int y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          float m[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
          for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0 - 0.5; }
          return 0.0;
        }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          gl_FragColor = c;
          #include <colorspace_fragment>
          vec2 px = floor(vUv * uRes);
          vec3 col = gl_FragColor.rgb + bayer(px) / uLevels;
          col = floor(col * uLevels + 0.5) / uLevels;
          // Viñeta suave para la atmósfera opresiva.
          vec2 d = vUv - 0.5;
          col *= 1.0 - dot(d, d) * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(width: number, height: number) {
    const h = this.internalHeight;
    const w = Math.round((width / height) * h);
    this.target.setSize(w, h);
    (this.material.uniforms.uRes!.value as THREE.Vector2).set(w, h);
    psxUniforms.uSnap.value.set(w / 2, h / 2);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
