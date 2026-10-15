import { describe, expect, it } from 'vitest';
import { GALAXY_DEFAULTS } from './galaxyGeometry';
import {
  fitCameraDistance,
  lookAt,
  multiply,
  perspective,
  rotationY,
} from './galaxyRenderer';

/** 列主序矩阵作用于点（齐次坐标 w 归一化后） */
function transform3(matrix: Float32Array, point: readonly number[]): [number, number, number] {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] || 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

/** 列主序矩阵作用于点，返回 NDC 的 xy */
function projectNdc(matrix: Float32Array, point: readonly number[]): [number, number] {
  const [x, y, z] = point;
  const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [cx / cw, cy / cw];
}

const FIT = {
  radiusMax: GALAXY_DEFAULTS.radiusMax,
  thickness: GALAXY_DEFAULTS.thickness,
  tilt: GALAXY_DEFAULTS.tilt,
  camElev: GALAXY_DEFAULTS.camElev,
  fov: GALAXY_DEFAULTS.fov,
  fitY: 0.95,
  fitX: 0.98,
};

function buildViewProj(aspect: number) {
  const distance = fitCameraDistance({ ...FIT, aspect });
  const elev = (FIT.camElev * Math.PI) / 180;
  const view = new Float32Array(16);
  const proj = new Float32Array(16);
  const viewProj = new Float32Array(16);
  lookAt([0, distance * Math.sin(elev), distance * Math.cos(elev)], [0, 1, 0], view);
  perspective((FIT.fov * Math.PI) / 180, aspect, 1, 4000, proj);
  multiply(proj, view, viewProj);
  return { viewProj, distance };
}

describe('perspective', () => {
  it('视线轴上的点投影到画面中心', () => {
    const proj = new Float32Array(16);
    perspective(Math.PI / 4, 16 / 9, 1, 4000, proj);
    expect(projectNdc(proj, [0, 0, -10])[0]).toBeCloseTo(0, 6);
    expect(projectNdc(proj, [0, 0, -10])[1]).toBeCloseTo(0, 6);
  });

  it('横向越宽的视口，同一世界宽度占 NDC 越少', () => {
    const wide = new Float32Array(16);
    const narrow = new Float32Array(16);
    perspective(Math.PI / 4, 2.4, 1, 4000, wide);
    perspective(Math.PI / 4, 1.0, 1, 4000, narrow);
    expect(Math.abs(projectNdc(wide, [5, 0, -10])[0])).toBeLessThan(
      Math.abs(projectNdc(narrow, [5, 0, -10])[0])
    );
  });
});

describe('rotationY', () => {
  it('绕 Y 轴旋转 90° 把 +X 送到 -Z', () => {
    const rot = new Float32Array(16);
    rotationY(Math.PI / 2, rot);
    const p = transform3(rot, [1, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(-1, 6);
  });

  it('旋转是刚体变换：半径与 y 不变', () => {
    const rot = new Float32Array(16);
    rotationY(1.234, rot);
    const p = transform3(rot, [37, 12, 84]);
    expect(p[1]).toBeCloseTo(12, 6);
    expect(Math.hypot(p[0], p[2])).toBeCloseTo(Math.hypot(37, 84), 6);
  });
});

describe('fitCameraDistance', () => {
  it('任何宽高比下星系盘都完整落在视口内', () => {
    const R = FIT.radiusMax * 1.08;
    const halfThickness = FIT.thickness * FIT.tilt * 2;
    for (const aspect of [0.5, 0.75, 1, 1.34, 1.56, 2.4, 3.2]) {
      const { viewProj } = buildViewProj(aspect);
      let maxAbsX = 0;
      let maxAbsY = 0;
      for (let i = 0; i < 96; i++) {
        const angle = (i / 96) * Math.PI * 2;
        for (const y of [-halfThickness, 0, halfThickness]) {
          const [ndcX, ndcY] = projectNdc(viewProj, [Math.cos(angle) * R, y, Math.sin(angle) * R]);
          maxAbsX = Math.max(maxAbsX, Math.abs(ndcX));
          maxAbsY = Math.max(maxAbsY, Math.abs(ndcY));
        }
      }
      expect(maxAbsX).toBeLessThanOrEqual(1);
      expect(maxAbsY).toBeLessThanOrEqual(1);
      // 且必须"占满"：至少一个方向达到 70% 以上，否则星云会缩成一小团
      expect(Math.max(maxAbsX, maxAbsY)).toBeGreaterThan(0.7);
    }
  });

  it('宽高比越大，相机距离越大（横向不再约束时由竖直约束接管）', () => {
    const wide = fitCameraDistance({ ...FIT, aspect: 3 });
    const square = fitCameraDistance({ ...FIT, aspect: 1 });
    expect(wide).not.toBe(square);
    expect(wide).toBeGreaterThan(0);
    expect(square).toBeGreaterThan(0);
  });
});

describe('lookAt（相机俯角语义）', () => {
  it('俯视 42° 时星系盘前缘落在屏幕下方、远缘落在上方', () => {
    const { viewProj } = buildViewProj(1.56);
    const near = projectNdc(viewProj, [0, 0, FIT.radiusMax]);
    const far = projectNdc(viewProj, [0, 0, -FIT.radiusMax]);
    expect(near[1]).toBeLessThan(0);
    expect(far[1]).toBeGreaterThan(0);
    // 透视下近端投影比远端更大（近大远小）
    expect(Math.abs(near[1])).toBeGreaterThan(Math.abs(far[1]));
  });
});
