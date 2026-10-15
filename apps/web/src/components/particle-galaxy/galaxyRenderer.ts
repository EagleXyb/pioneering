/**
 * galaxyRenderer —— ParticleGalaxy 的 WebGL2 渲染后端（零依赖，非 three.js）。
 *
 * 逐模块对应参考实现「螺旋星系 · 静态单帧」的渲染管线：
 *   ① 点精灵程序      ← pointMaterial()：gl_PointSize = aSize·PR·(K/depth)，软边圆点 + 加法混合
 *   ② 亮核 sprite     ← §7 三层径向渐变 Sprite（billboard quad，非等比缩放 0.72）
 *   ③ 亮度阈值提取     ← UnrealBloomPass 的 LuminosityHighPassShader
 *   ④ 可分离高斯模糊   ← UnrealBloomPass 的 blur（两级：1/2 + 1/4 分辨率）
 *   ⑤ 合成调色        ← 自定义 ShaderPass：曝光 / 暗角 / 柔和压缩 / gamma 2.2
 *
 * 与参考实现的差异（有意为之）：
 *   · 不引入 three.js —— 上述 5 个程序与 1 张 FBO 链已在 ~500 行内闭合
 *   · 相机距离由容器宽高比反解（fit），保证任何视口下星系不被裁切
 *   · 预乘输出 + 柔边 alpha 由 aSoft 承担（three 的 AdditiveBlending 在
 *     premultipliedAlpha 上下文中会丢弃 alpha，导致圆点边缘偏硬）
 *   · 浅色主题走 normal 混合（加法在浅底上会被吞掉），并关掉 HDR 色调压缩
 */

import {
  srgbHexToLinear,
  type GalaxyGeometry,
  type PointLayerData,
} from './galaxyGeometry';

type GL = WebGL2RenderingContext;

/* ==================================================================== 常量 */

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  // 画在页面底色之上 → 必须透明；点精灵没有几何边缘，antialias 无收益
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'low-power',
};

/** 亮核三层 sprite（参考实现 [[40,0.055],[18,0.030],[8,0.012]]） */
export interface CoreSpriteSpec {
  size: number;
  inner: number;
  opacity: number;
}

export interface GalaxyRenderParams {
  fov: number;
  /** 相机俯角（度）——决定星系盘的椭圆压扁比 */
  camElev: number;
  radiusMax: number;
  thickness: number;
  /** 厚度方向压缩（fit 求解 y 极值用） */
  tilt: number;
  /** 竖直方向占容器半高的目标比例（fit 求解用） */
  fitY: number;
  /** 水平方向占容器半宽的目标比例 */
  fitX: number;
  pointK: number;
  /** gl_PointSize 标定参考高度（CSS px） */
  refHeight: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** 阈值软过渡宽度 */
  bloomSmooth: number;
  exposure: number;
  /** true = 加法混合（深色）；false = normal 混合（浅色） */
  additive: boolean;
  clearColor: [number, number, number, number];
  vignette: boolean;
  toneMap: boolean;
  coreSprites: CoreSpriteSpec[];
  /** 亮核纹理的 4 个径向停靠色（rgba 字符串） */
  coreSpriteStops: [string, string, string, string];
}

/* ================================================================ GLSL 源 */

const POINTS_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;
layout(location = 3) in float aBright;
uniform mat4 uViewProj;
uniform float uPR;
uniform float uK;
uniform float uMaxPoint;
out vec3 vColor;
out float vB;
void main() {
  vColor = aColor;
  vB = aBright;
  gl_Position = uViewProj * vec4(aPos, 1.0);
  // gl_Position.w = 相机空间深度（透视矩阵第 4 行），用于近大远小
  float depth = max(gl_Position.w, 1.0);
  gl_PointSize = min(aSize * uPR * (uK / depth), uMaxPoint);
}`;

const POINTS_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vB;
uniform float uSoft;
out vec4 outColor;
void main() {
  float d = distance(gl_PointCoord, vec2(0.5));
  if (d > 0.5) discard;
  float a = pow(smoothstep(0.5, 0.0, d), uSoft);
  // 亮度由 vB 线性决定（与参考实现一致），a 只负责柔边衰减；预乘输出
  outColor = vec4(vColor * vB * a, vB * a);
}`;

const QUAD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
out vec2 vUv;
void main() {
  vUv = aQuad * 0.5 + 0.5;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

const SPRITE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vUv = aQuad * 0.5 + 0.5;
  // billboard：在相机空间以世界原点为中心铺开
  vec4 center = uView * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 p = vec4(center.xy + aQuad * uSize * 0.5, center.z, 1.0);
  gl_Position = uProj * p;
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUv);
  vec3 rgb = pow(t.rgb, vec3(2.2)); // canvas 像素为 sRGB → 线性
  float a = t.a * uOpacity;
  outColor = vec4(rgb * a, a);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uSmooth;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float f = clamp((lum - uThreshold) / max(uSmooth, 1e-4), 0.0, 1.0);
  outColor = vec4(c * f, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 outColor;
// sigma = 2 的 9 tap 高斯（对称，5 个权重）
const float W[5] = float[5](0.2042, 0.1802, 0.1238, 0.0663, 0.0276);
void main() {
  vec3 sum = texture(uTex, vUv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDir * float(i);
    sum += texture(uTex, vUv + off).rgb * W[i];
    sum += texture(uTex, vUv - off).rgb * W[i];
  }
  outColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloomHi;
uniform sampler2D uBloomLo;
uniform float uBloomStrength;
uniform float uBloomHiMix;
uniform float uBloomLoMix;
uniform float uExposure;
uniform float uVignette;
uniform float uToneMap;
out vec4 outColor;
void main() {
  vec4 s = texture(uScene, vUv);
  vec3 b = texture(uBloomHi, vUv).rgb * uBloomHiMix + texture(uBloomLo, vUv).rgb * uBloomLoMix;

  // FBO 里是预乘色（rgb = 颜色 × alpha）。曝光 / 暗角 / 色调压缩 / gamma
  // 都必须作用在「非预乘」颜色上：直接对预乘色做 gamma 会把低 alpha 区域的
  // rgb 抬得远大于 alpha，浏览器按预乘合成时就会浮出一层白雾。
  float a = clamp(s.a + max(max(b.r, b.g), b.b) * uBloomStrength, 0.0, 1.0);

  float v = 1.0;
  if (uVignette > 0.5) {
    float d = distance(vUv, vec2(0.5)) * 2.0;
    v = clamp((1.05 - d) / 0.75, 0.0, 1.0);
    v = v * v * (3.0 - 2.0 * v);
  }
  a *= v;

  vec3 straight = (a > 0.0002) ? (s.rgb + b * uBloomStrength) / a : vec3(0.0);
  straight *= uExposure;
  if (uToneMap > 0.5) straight = straight / (straight + vec3(0.85)) * 1.85; // 柔和压缩，保住紫调不过曝
  straight = pow(max(straight, vec3(0.0)), vec3(1.0 / 2.2));               // linear → sRGB

  outColor = vec4(straight * a, a);
}`;

/* ============================================================== 矩阵工具 */

function perspective(fovY: number, aspect: number, near: number, far: number, out: Float32Array): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** 相机位于 eye，看向原点，up 为 +Y（列主序） */
function lookAt(eye: readonly number[], up: readonly number[], out: Float32Array): Float32Array {
  const len = Math.hypot(eye[0], eye[1], eye[2]) || 1;
  const f = [-eye[0] / len, -eye[1] / len, -eye[2] / len];
  let r = [
    f[1] * up[2] - f[2] * up[1],
    f[2] * up[0] - f[0] * up[2],
    f[0] * up[1] - f[1] * up[0],
  ];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  out[0] = r[0]; out[4] = r[1]; out[8] = r[2]; out[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
  out[1] = u[0]; out[5] = u[1]; out[9] = u[2]; out[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/** 绕 Y 轴旋转（列主序） */
function rotationY(angle: number, out: Float32Array): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[0] = c; out[1] = 0; out[2] = -s; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = s; out[9] = 0; out[10] = c; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/** out = a · b（列主序；out 不可与 a/b 同引用） */
function multiply(a: Float32Array, b: Float32Array, out: Float32Array): Float32Array {
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4];
    const b1 = b[i * 4 + 1];
    const b2 = b[i * 4 + 2];
    const b3 = b[i * 4 + 3];
    out[i * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[i * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[i * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[i * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

const degToRad = (deg: number) => (deg * Math.PI) / 180;

export interface CameraFitOptions {
  /** 容器宽高比（缓冲尺寸） */
  aspect: number;
  radiusMax: number;
  thickness: number;
  /** 厚度方向压缩（决定 y 极值） */
  tilt: number;
  camElev: number;
  fov: number;
  /** 竖直方向占容器半高的目标比例 */
  fitY: number;
  /** 水平方向占容器半宽的目标比例 */
  fitX: number;
}

/**
 * 由容器宽高比反解相机距离。
 *
 * 相机基：right = +X，up = (0, cos e, -sin e)，forward = (0, -sin e, -cos e)，
 * 因此相机空间坐标为
 *   x_v = x,  y_v = y·cos e − z·sin e,  w = d − z·cos e − y·sin e
 * 盘上最"高"的投影点为近缘（z = R，同时 y 取最大厚度）：
 *   |y_v| ≤ R·sin e + h·cos e，此时 w 最小 = d − R·cos e − h·sin e
 * 水平方向同理（x = R 时 z = 0，y 取最大厚度 → w = d − h·sin e）。
 * 两个方向分别解出所需距离取较大者 → 任何视口下都不裁切，且尽量占满可见区。
 */
export function fitCameraDistance(options: CameraFitOptions): number {
  const { aspect, radiusMax, thickness, tilt, camElev, fov, fitY, fitX } = options;
  const elev = degToRad(camElev);
  const cot = 1 / Math.tan(degToRad(fov) / 2);
  const r = radiusMax * 1.08; // 弥散晕/散布会让极少数粒子略微超出 radiusMax
  // y 极值：gauss ≤ 1、厚度最厚处的内层粒子（thickMul = 1.5）+ 0.35 底厚
  const halfThickness = (thickness + 0.35) * 1.5 * Math.abs(tilt);
  const depthMargin = halfThickness * Math.sin(elev);

  const halfY = r * Math.sin(elev) + halfThickness * Math.cos(elev);
  const distanceForY = (halfY * cot) / Math.max(fitY, 0.05) + r * Math.cos(elev) + depthMargin;
  // 水平最坏点不在 z = 0：对 x = R·cosθ、z = R·sinθ 求 cosθ/(d − R·sinθ·cos e) 的极值，
  // 得 max|ndc_x| = (R·cot/aspect)/√(d² − (R·cos e)²)，反解得下面这个精确距离。
  const spanX = (r * cot) / (Math.max(aspect, 0.2) * Math.max(fitX, 0.05));
  const u = r * Math.cos(elev);
  const distanceForX = Math.sqrt(u * u + spanX * spanX) + depthMargin;
  return Math.max(distanceForY, distanceForX, 10);
}

/* ============================================================== 上下文缓存 */

/**
 * canvas → WebGL2 上下文。React StrictMode 会挂载两次，重复 getContext 虽返回
 * 同一上下文，但缓存可避免重复创建资源前的状态重设；同时我们在 dispose 中
 * **不** 调用 loseContext（否则第二次挂载会拿到已丢失的上下文）。
 */
const contextCache = new WeakMap<HTMLCanvasElement, GL | null>();

export function acquireContext(canvas: HTMLCanvasElement): GL | null {
  const cached = contextCache.get(canvas);
  if (cached !== undefined) return cached;
  let gl: GL | null = null;
  try {
    gl = (canvas.getContext('webgl2', CONTEXT_ATTRIBUTES) as GL | null) ?? null;
  } catch {
    gl = null;
  }
  contextCache.set(canvas, gl);
  return gl;
}

/* ================================================================ 编译工具 */

interface GlProgram {
  program: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

function compileShader(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function createGlProgram(gl: GL, vsSource: string, fsSource: string): GlProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    u: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    },
  };
}

/** 深色 / 浅色主题的亮核纹理停靠色（sRGB rgba 字符串） */
export const CORE_SPRITE_STOPS_DARK: [string, string, string, string] = [
  'rgba(255,255,255,1)',
  'rgba(226,198,255,0.55)',
  'rgba(150,95,255,0.16)',
  'rgba(60,20,120,0)',
];

export const CORE_SPRITE_STOPS_LIGHT: [string, string, string, string] = [
  'rgba(109,40,217,0.9)',
  'rgba(139,92,246,0.45)',
  'rgba(167,139,250,0.14)',
  'rgba(196,181,253,0)',
];

function createCoreTexture(
  gl: GL,
  inner: number,
  stops: [string, string, string, string]
): WebGLTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture failed');
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(inner, stops[1]);
    grad.addColorStop(0.42, stops[2]);
    grad.addColorStop(1, stops[3]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/* ================================================================ 渲染目标 */

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

/* ================================================================== 渲染器 */

export class GalaxyRenderer {
  private readonly gl: GL;
  private readonly canvas: HTMLCanvasElement;
  private readonly geometry: GalaxyGeometry;
  private readonly params: GalaxyRenderParams;

  private readonly hdr: boolean;
  private readonly maxPointSize: number;

  private readonly pointsProgram: GlProgram;
  private readonly spriteProgram: GlProgram;
  private readonly brightProgram: GlProgram;
  private readonly blurProgram: GlProgram;
  private readonly compositeProgram: GlProgram;

  private readonly layers: Array<{
    data: PointLayerData;
    vao: WebGLVertexArrayObject;
    buffers: WebGLBuffer[];
  }> = [];

  private readonly sprites: Array<{
    texture: WebGLTexture;
    size: number;
    opacity: number;
  }> = [];

  private quadVao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  private targets: {
    scene: RenderTarget;
    halfA: RenderTarget;
    halfB: RenderTarget;
    quartA: RenderTarget;
    quartB: RenderTarget;
  } | null = null;

  private cssWidth = 1;
  private cssHeight = 1;
  private bufferWidth = 0;
  private bufferHeight = 0;
  private ratio = 1;

  private readonly proj = new Float32Array(16);
  private readonly view = new Float32Array(16);
  private readonly rot = new Float32Array(16);
  private readonly viewRot = new Float32Array(16);
  private readonly viewProj = new Float32Array(16);

  private angle = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, geometry: GalaxyGeometry, params: GalaxyRenderParams) {
    const gl = acquireContext(canvas);
    if (!gl) throw new Error('WebGL2 unavailable');

    this.gl = gl;
    this.canvas = canvas;
    this.geometry = geometry;
    this.params = params;

    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    // 部分驱动对点尺寸上限很小（移动端常见 64），必须显式收敛
    this.maxPointSize = Math.min(pointRange && pointRange.length > 1 ? pointRange[1] : 64, 255);

    this.pointsProgram = createGlProgram(gl, POINTS_VS, POINTS_FS);
    this.spriteProgram = createGlProgram(gl, SPRITE_VS, SPRITE_FS);
    this.brightProgram = createGlProgram(gl, QUAD_VS, BRIGHT_FS);
    this.blurProgram = createGlProgram(gl, QUAD_VS, BLUR_FS);
    this.compositeProgram = createGlProgram(gl, QUAD_VS, COMPOSITE_FS);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    this.createQuad();
    this.createLayers();
    this.createSprites();
    this.updateCamera();
  }

  /* ------------------------------------------------------------- 资源创建 */

  private createQuad(): void {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!buffer || !vao) throw new Error('createQuad failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quadVao = vao;
    this.quadBuffer = buffer;
  }

  private createLayer(data: PointLayerData): void {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    const buffers: WebGLBuffer[] = [];
    const attributes: Array<{ array: Float32Array; size: number; location: number }> = [
      { array: data.position, size: 3, location: 0 },
      { array: data.color, size: 3, location: 1 },
      { array: data.size, size: 1, location: 2 },
      { array: data.bright, size: 1, location: 3 },
    ];

    gl.bindVertexArray(vao);
    for (const attribute of attributes) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('createBuffer failed');
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, attribute.array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(attribute.location);
      gl.vertexAttribPointer(attribute.location, attribute.size, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);

    this.layers.push({ data, vao, buffers });
  }

  private createLayers(): void {
    // 绘制顺序与参考实现一致：尘埃 → 恒星 → （亮核） → 背景深空星
    this.createLayer(this.geometry.dust);
    this.createLayer(this.geometry.stars);
    this.createLayer(this.geometry.bg);
  }

  private createSprites(): void {
    const gl = this.gl;
    for (const spec of this.params.coreSprites) {
      const texture = createCoreTexture(gl, spec.inner, this.params.coreSpriteStops);
      this.sprites.push({ texture, size: spec.size, opacity: spec.opacity });
    }
  }

  private createTarget(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('createTarget failed');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.hdr) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
    }
    return { texture, framebuffer, width, height };
  }

  private dropTarget(target: RenderTarget | null): void {
    if (!target) return;
    this.gl.deleteTexture(target.texture);
    this.gl.deleteFramebuffer(target.framebuffer);
  }

  private dropTargets(): void {
    if (!this.targets) return;
    for (const target of Object.values(this.targets)) this.dropTarget(target);
    this.targets = null;
  }

  private rebuildTargets(): void {
    this.dropTargets();
    const half = (value: number) => Math.max(1, value >> 1);
    const quarter = (value: number) => Math.max(1, value >> 2);
    this.targets = {
      scene: this.createTarget(this.bufferWidth, this.bufferHeight),
      halfA: this.createTarget(half(this.bufferWidth), half(this.bufferHeight)),
      halfB: this.createTarget(half(this.bufferWidth), half(this.bufferHeight)),
      quartA: this.createTarget(quarter(this.bufferWidth), quarter(this.bufferHeight)),
      quartB: this.createTarget(quarter(this.bufferWidth), quarter(this.bufferHeight)),
    };
  }

  /* ------------------------------------------------------------- 尺寸/相机 */

  private updateCamera(): void {
    const aspect = this.bufferWidth / Math.max(1, this.bufferHeight);
    const distance = fitCameraDistance({ ...this.params, aspect });
    const elev = degToRad(this.params.camElev);
    lookAt([0, distance * Math.sin(elev), distance * Math.cos(elev)], [0, 1, 0], this.view);
    perspective(degToRad(this.params.fov), aspect, 1, 4000, this.proj);
  }

  /** 返回是否需要重绘（尺寸未变则为 false） */
  setSize(cssWidth: number, cssHeight: number, ratio: number): boolean {
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (width === this.bufferWidth && height === this.bufferHeight) return false;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.ratio = ratio;
    this.bufferWidth = width;
    this.bufferHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.rebuildTargets();
    this.updateCamera();
    return true;
  }

  setAngle(angle: number): void {
    this.angle = angle;
  }

  /* ------------------------------------------------------------------ 绘制 */

  private applyBlend(): void {
    const gl = this.gl;
    // 输出为预乘（rgb·a, a）：加法用 ONE/ONE，normal 用标准 over
    if (this.params.additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private drawLayer(index: number): void {
    const gl = this.gl;
    const layer = this.layers[index];
    if (!layer || layer.data.count <= 0) return;
    const { pointsProgram, params } = this;
    // 每次绘制都由本方法自行绑定 program：亮核 sprite 会改写当前 program
    gl.useProgram(pointsProgram.program);
    gl.uniformMatrix4fv(pointsProgram.u('uViewProj'), false, this.viewProj);
    // 点尺寸随容器高度标定，保证不同视口下颗粒感一致
    gl.uniform1f(pointsProgram.u('uK'), params.pointK * (this.cssHeight / params.refHeight));
    gl.uniform1f(pointsProgram.u('uMaxPoint'), this.maxPointSize);
    gl.uniform1f(pointsProgram.u('uPR'), Math.min(this.ratio, layer.data.prCap));
    gl.uniform1f(pointsProgram.u('uSoft'), layer.data.soft);
    gl.bindVertexArray(layer.vao);
    gl.drawArrays(gl.POINTS, 0, layer.data.count);
  }

  private drawSprites(): void {
    const gl = this.gl;
    if (!this.sprites.length || !this.quadVao) return;
    const { spriteProgram } = this;
    gl.useProgram(spriteProgram.program);
    gl.uniformMatrix4fv(spriteProgram.u('uView'), false, this.viewRot);
    gl.uniformMatrix4fv(spriteProgram.u('uProj'), false, this.proj);
    gl.uniform1i(spriteProgram.u('uTex'), 0);
    gl.bindVertexArray(this.quadVao);
    for (const sprite of this.sprites) {
      gl.uniform2f(spriteProgram.u('uSize'), sprite.size, sprite.size * 0.72);
      gl.uniform1f(spriteProgram.u('uOpacity'), sprite.opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  private runPass(
    target: RenderTarget,
    program: GlProgram,
    setup: () => void
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(program.program);
    gl.bindVertexArray(this.quadVao);
    setup();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private blit(target: RenderTarget, program: GlProgram, setup: () => void): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    this.runPass(target, program, setup);
  }

  render(): void {
    if (this.disposed || !this.targets) return;
    const gl = this.gl;
    const { params, targets } = this;
    if (!targets) return;

    rotationY(this.angle, this.rot);
    multiply(this.view, this.rot, this.viewRot);
    multiply(this.proj, this.viewRot, this.viewProj);

    /* ① 场景：点精灵 + 亮核 sprite 直接渲进 HDR 目标 */
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene.framebuffer);
    gl.viewport(0, 0, targets.scene.width, targets.scene.height);
    gl.clearColor(params.clearColor[0], params.clearColor[1], params.clearColor[2], params.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    this.applyBlend();
    this.drawLayer(0); // 尘埃（大柔光斑）—— 参考实现最先绘制
    this.drawLayer(1); // 恒星
    this.drawSprites(); // 中心亮核
    this.drawLayer(2); // 背景深空星
    gl.bindVertexArray(null);

    /* ② Bloom：亮度阈值提取 → 两级可分离高斯 → 1/2 + 1/4 叠加 */
    // 强度为 0（如浅色主题）时整段跳过，合成阶段直接采场景纹理占位
    const bloomEnabled = params.bloomStrength > 0.001;
    if (bloomEnabled) {
      const spread = Math.max(0.5, params.bloomRadius * 2.5);
      this.blit(targets.halfA, this.brightProgram, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets.scene.texture);
        gl.uniform1i(this.brightProgram.u('uTex'), 0);
        gl.uniform1f(this.brightProgram.u('uThreshold'), params.bloomThreshold);
        gl.uniform1f(this.brightProgram.u('uSmooth'), params.bloomSmooth);
      });

      const blur = (to: RenderTarget, from: RenderTarget, dx: number, dy: number) => {
        this.blit(to, this.blurProgram, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, from.texture);
          gl.uniform1i(this.blurProgram.u('uTex'), 0);
          gl.uniform2f(this.blurProgram.u('uDir'), dx / from.width, dy / from.height);
        });
      };

      blur(targets.halfB, targets.halfA, spread, 0);
      blur(targets.halfA, targets.halfB, 0, spread);
      blur(targets.quartA, targets.halfA, spread * 0.8, 0); // 顺带降采样
      blur(targets.quartB, targets.quartA, 0, spread * 0.8);
    }

    /* ③ 合成到屏幕（透明背景，与页面底色叠加） */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.bufferWidth, this.bufferHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(this.compositeProgram.program);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.scene.texture);
    gl.uniform1i(this.compositeProgram.u('uScene'), 0);
    const bloomHiTexture = bloomEnabled ? targets.halfA.texture : targets.scene.texture;
    const bloomLoTexture = bloomEnabled ? targets.quartB.texture : targets.scene.texture;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomHiTexture);
    gl.uniform1i(this.compositeProgram.u('uBloomHi'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, bloomLoTexture);
    gl.uniform1i(this.compositeProgram.u('uBloomLo'), 2);
    gl.uniform1f(this.compositeProgram.u('uBloomStrength'), params.bloomStrength);
    gl.uniform1f(this.compositeProgram.u('uBloomHiMix'), bloomEnabled ? 0.65 : 0);
    gl.uniform1f(this.compositeProgram.u('uBloomLoMix'), bloomEnabled ? 1.0 : 0);
    gl.uniform1f(this.compositeProgram.u('uExposure'), params.exposure);
    gl.uniform1f(this.compositeProgram.u('uVignette'), params.vignette ? 1 : 0);
    gl.uniform1f(this.compositeProgram.u('uToneMap'), params.toneMap ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /* ------------------------------------------------------------------ 释放 */

  dispose(): void {
    if (this.disposed) return;
    const gl = this.gl;
    this.disposed = true;
    for (const layer of this.layers) {
      gl.deleteVertexArray(layer.vao);
      for (const buffer of layer.buffers) gl.deleteBuffer(buffer);
    }
    this.layers.length = 0;
    for (const sprite of this.sprites) gl.deleteTexture(sprite.texture);
    this.sprites.length = 0;
    if (this.quadVao) gl.deleteVertexArray(this.quadVao);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    this.quadVao = null;
    this.quadBuffer = null;
    this.dropTargets();
    for (const program of [
      this.pointsProgram,
      this.spriteProgram,
      this.brightProgram,
      this.blurProgram,
      this.compositeProgram,
    ]) {
      gl.deleteProgram(program.program);
    }
  }
}

export { degToRad, lookAt, multiply, perspective, rotationY };
