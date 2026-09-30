// scene-builder.js — 把照片"立"成可走入的三维世界, 还原其中的树/房屋/天空/云彩
// 设计:
//   • 深度位移照片网格: 照片贴在高细分平面上, 每个顶点按深度图沿 Z 位移, 树/房屋/云
//     各在其深度层上突起; 下半部分折叠成水平地面, 角色可走进照片。
//   • 天空穹顶: 照片贴在巨大球体内壁, 还原天空与云彩(环绕/仰视可见)。
//   • 颜色检测补植: 扫描照片绿色区域, 在地面相应位置补植真正的低多边形 3D 树。
//   • 地面: 折面照片底纹 + 照片底色延伸地面, 无通用草皮, 与照片一致。
//   • 无方盒: 无侧墙/背板, 两侧靠雾过渡到天空穹顶。

import * as THREE from 'three';
import { buildLakeside } from './lakeside.js';

// ---------- 照片分析 ----------
function analyzeImage(image) {
  const w = 96, h = 96;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const avg = (x0, y0, x1, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
  };
  const sky = avg(0, 0, w, Math.floor(h * 0.18));
  const ground = avg(0, Math.floor(h * 0.78), w, h);
  // 绿色点(树)采样: 返回 [u,v] 列表(归一化坐标, 仅照片下半部分)
  const greens = [];
  for (let y = Math.floor(h * 0.35); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (g > r + 18 && g > b + 18 && g > 60) {
        greens.push([x / (w - 1), y / (h - 1)]);
      }
    }
  }
  return { sky, ground, greens, w, h };
}

// 把绿色点聚成有限数量的树位(网格降采样)
function clusterGreens(greens, cell = 0.08, maxN = 14) {
  const buckets = {};
  for (const [u, v] of greens) {
    const key = `${Math.floor(u / cell)},${Math.floor(v / cell)}`;
    if (!buckets[key]) buckets[key] = { u: 0, v: 0, n: 0 };
    const bk = buckets[key];
    bk.u += u; bk.v += v; bk.n++;
  }
  return Object.values(buckets)
    .map(b => ({ u: b.u / b.n, v: b.v / b.n, count: b.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxN);
}

export class SceneBuilder {
  constructor() {
    this.group = null;
    this.disposables = [];
  }

  build(image, depth, opts = {}) {
    this.dispose();
    if (opts.sceneId === 'default-111') {
      const world = buildLakeside(image, opts.grassImage);
      this.group = world.group;
      this.disposables = world.resources;
      this.meta = world.meta;
      this.updateWorld = world.update;
      return world;
    }
    const depthStrength = opts.depthStrength ?? 3.2;
    const foldRatio = opts.foldRatio ?? 0.4; // 从底部起多大比例折成地面

    const group = new THREE.Group();
    const pal = analyzeImage(image);
    const trees = clusterGreens(pal.greens);

    const aspect = image.width / image.height;
    const H = 9;                       // 照片高度(世界单位)
    const W = H * aspect;
    const dw = depth.width, dh = depth.height, depthData = depth.data;

    const photoTex = new THREE.Texture(image);
    photoTex.colorSpace = THREE.SRGBColorSpace;
    photoTex.anisotropy = 8;
    photoTex.needsUpdate = true;
    this.disposables.push(photoTex);

    // ---------- 天空穹顶: 照片还原天空/云彩 ----------
    const skyGeo = new THREE.SphereGeometry(90, 40, 24);
    const skyMat = new THREE.MeshBasicMaterial({ map: photoTex, side: THREE.BackSide, depthWrite: false });
    this.disposables.push(skyGeo, skyMat);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    group.add(sky);

    // ---------- 主照片网格: 深度位移 + 折面 ----------
    const segW = Math.min(320, Math.max(120, Math.round(240)));
    const segH = Math.min(360, Math.max(120, Math.round(240 / aspect)));
    const geo = new THREE.PlaneGeometry(W, H, segW, segH);
    const pos = geo.attributes.position;
    const uvAttr = geo.attributes.uv;

    const foldY = H * (foldRatio - 0.5);     // 折线(地面高度)
    const floorForward = foldRatio * H;      // 地面延伸深度

    const sampleDepth = (u, vBot) => {
      const col = Math.min(dw - 1, Math.max(0, Math.round(u * (dw - 1))));
      const row = Math.min(dh - 1, Math.max(0, Math.round((1 - vBot) * (dh - 1))));
      return depthData[row * dw + col];
    };

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      const u = uvAttr.getX(i);
      const vBot = uvAttr.getY(i);
      const d = sampleDepth(u, vBot);
      const dz = d * depthStrength;
      if (ly > foldY) {
        // 墙面: 树/房屋/云按深度突起
        pos.setZ(i, dz);
      } else {
        // 地面: 折叠到水平, 纵深转前向深度
        const forward = (foldY - ly) * 1.0;
        pos.setX(i, lx);
        pos.setY(i, foldY);
        pos.setZ(i, dz + forward);
      }
    }
    geo.computeVertexNormals();
    this.disposables.push(geo);

    const photoMat = new THREE.MeshStandardMaterial({
      map: photoTex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    });
    this.disposables.push(photoMat);
    const relief = new THREE.Mesh(geo, photoMat);
    group.add(relief);

    // ---------- 延伸地面(照片底色, 供走得更远) ----------
    const extend = 8;
    const extGeo = new THREE.PlaneGeometry(W * 1.3 + 6, floorForward + extend + 2);
    const extMat = new THREE.MeshStandardMaterial({
      color: pal.ground, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    this.disposables.push(extGeo, extMat);
    const extFloor = new THREE.Mesh(extGeo, extMat);
    extFloor.rotation.x = -Math.PI / 2;
    extFloor.position.set(0, foldY + 0.01, floorForward / 2 + extend / 2 + 0.5);
    group.add(extFloor);

    // ---------- 颜色检测补植: 真正的 3D 树 ----------
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: pal.ground.clone().lerp(new THREE.Color(0.2, 0.45, 0.18), 0.6), roughness: 1, flatShading: true });
    this.disposables.push(trunkMat, leafMat);
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.9, 6);
    const leafGeo = new THREE.ConeGeometry(0.6, 1.5, 7);
    this.disposables.push(trunkGeo, leafGeo);

    // 照片(u,v) -> 地面世界坐标: u 横向 x, v(底=0) -> 前向 z
    const groundZForV = (v) => {
      // v=0(照片底) -> 折面起点(z≈0); v=1(照片顶折线) -> floorForward
      return v * floorForward;
    };
    for (const t of trees) {
      const x = (t.u - 0.5) * W;
      const z = groundZForV(1 - t.v); // t.v 是从顶起算的归一化行; 转成离折线距离
      if (z < 0.2 || z > floorForward + extend - 1) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.45;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.y = 1.55;
      const s = 0.7 + Math.min(1.4, t.count / 40);
      tree.scale.setScalar(s);
      tree.position.set(x, foldY, z);
      tree.add(trunk, leaf);
      group.add(tree);
    }

    this.group = group;
    const maxZ = floorForward + extend - 0.5;
    this.meta = {
      groundY: foldY,
      heightAt: () => foldY, // 折面地面平整
      bounds: { minX: -W / 2 - 1.2, maxX: W / 2 + 1.2, minZ: 0.4, maxZ },
    };
    return { group, meta: this.meta, fogColor: pal.sky };
  }

  dispose() {
    this.updateWorld = null;
    for (const d of this.disposables) d?.dispose?.();
    this.disposables = [];
    if (this.group) {
      this.group.traverse(o => {
        if (o.geometry && !this.disposables.includes(o.geometry)) o.geometry.dispose?.();
        if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); }
      });
      if (this.group.parent) this.group.parent.remove(this.group);
    }
    this.group = null;
  }

  update(dt) { this.updateWorld?.(dt); }
}
