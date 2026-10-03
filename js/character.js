// character.js — 纪念碑谷风格角色 + 第三人称控制
// 角色: 白色几何体(锥形袍身 + 头 + 尖帽), 扁平着色, 无四肢;
//      行走时整体轻微上下浮动 + 优雅晃动。随地形高度起伏。

import * as THREE from 'three';

export class Character {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.group = new THREE.Group();
    this.buildMesh();

    this.pos = new THREE.Vector3(0, 0, 8);
    this.facing = 0;
    this.camYaw = 0;
    this.camPitch = 0.5;        // 略高俯视, 更接近纪念碑谷视角
    this.camDist = 8;
    this.speed = 0;
    this.terrainFn = null;      // 地形高度查询 (x,z)->y
    this.bounds = { minX: -28, maxX: 28, minZ: -28, maxZ: 28 };

    this.keys = {};
    this._animTime = 0;
    this._enabled = false;

    this._bindEvents();
    this.update(0);
  }

  buildMesh() {
    const g = this.group;
    // 单一白色磨砂材质 + 一个略暗的帽, 扁平着色
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.85, metalness: 0, flatShading: true });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.85, metalness: 0, flatShading: true });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb388ff, roughness: 0.8, flatShading: true });

    // 袍身: 下宽上窄的圆台(棋子 silhouette)
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, 0.95, 12), bodyMat);
    robe.position.y = 0.5;
    g.add(robe);
    // 袍底裙边(深紫点缀, 呼应纪念碑谷配色)
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 12), trimMat);
    hem.position.y = 0.04;
    g.add(hem);
    // 头
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), bodyMat);
    head.position.y = 1.18;
    g.add(head);
    // 尖帽(圆锥)
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 12), hatMat);
    hat.position.y = 1.6;
    g.add(hat);
    // 帽尖小球
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), trimMat);
    tip.position.y = 1.88;
    g.add(tip);
    for (const part of [robe, hem, head, hat, tip]) part.castShadow = true;

    // Soft contact shadow stays attached to the ground while the body bobs.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64,64,8,64,64,62);
    gradient.addColorStop(0,'rgba(0,0,0,.45)');
    gradient.addColorStop(.46,'rgba(0,0,0,.20)');
    gradient.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
    const shadowMat = new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(shadowCanvas), transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1 });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9,1.12), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    g.add(this.shadow);

    this.body = g; // 整体用于动画微动
  }

  setBounds(b) { this.bounds = b; }
  setTerrain(fn) { this.terrainFn = fn; }
  setWalkable(fn) { this.walkableFn = fn; }
  setEnabled(v) { this._enabled = v; }

  _bindEvents() {
    this._onKeyDown = e => {
      if(e.target.closest?.('input,textarea,select,dialog,[contenteditable]'))return;
      this.keys[e.code] = true;
      if (['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code) && this._enabled) e.preventDefault();
    };
    this._onKeyUp = e => { this.keys[e.code] = false; };
    this._onMouseDown = e => { if (e.button !== 0) return; this._dragging = true; this._lastX = e.clientX; this._lastY = e.clientY; };
    this._onMouseMove = e => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      this.camYaw -= dx * 0.005;
      this.camPitch = Math.max(0.05, Math.min(1.25, this.camPitch + dy * 0.005));
    };
    this._onMouseUp = () => { this._dragging = false; };
    this._onWheel = e => { this.camDist = Math.max(4, Math.min(18, this.camDist + e.deltaY * 0.01)); e.preventDefault(); };
    this._onTouchStart = e => { if (e.touches.length === 1) { this._dragging = true; this._lastX = e.touches[0].clientX; this._lastY = e.touches[0].clientY; } };
    this._onTouchMove = e => {
      if (!this._dragging || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - this._lastX, dy = t.clientY - this._lastY;
      this._lastX = t.clientX; this._lastY = t.clientY;
      this.camYaw -= dx * 0.005;
      this.camPitch = Math.max(0.05, Math.min(1.25, this.camPitch + dy * 0.005));
      e.preventDefault();
    };
    this._onTouchEnd = () => { this._dragging = false; };
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    this.dom.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.dom.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.dom.addEventListener('touchend', this._onTouchEnd);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.dom.removeEventListener('wheel', this._onWheel);
    this.dom.removeEventListener('touchstart', this._onTouchStart);
    this.dom.removeEventListener('touchmove', this._onTouchMove);
    this.dom.removeEventListener('touchend', this._onTouchEnd);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);

    // ---- 输入 ----
    let ix = 0, iz = 0;
    if (this._enabled) {
      if (this.keys['KeyW']) iz -= 1;
      if (this.keys['KeyS']) iz += 1;
      if (this.keys['KeyA']) ix -= 1;
      if (this.keys['KeyD']) ix += 1;
    }
    const run = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1.7 : 1;
    const baseSpeed = 4.0 * run;

    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).normalize();
    const forward = fwd.clone().multiplyScalar(-1); // 屏幕里方向
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    const move = new THREE.Vector3();
    move.addScaledVector(forward, -iz);
    move.addScaledVector(right, ix);
    const moving = move.lengthSq() > 0.0001;
    if (moving) move.normalize();

    const oldX=this.pos.x,oldZ=this.pos.z;
    this.pos.addScaledVector(move, baseSpeed * dt);

    const b = this.bounds;
    this.pos.x = Math.max(b.minX, Math.min(b.maxX, this.pos.x));
    this.pos.z = Math.max(b.minZ, Math.min(b.maxZ, this.pos.z));

    if(this.walkableFn && !this.walkableFn(this.pos.x,this.pos.z)){this.pos.x=oldX;this.pos.z=oldZ;}

    if (moving) {
      const targetFacing = Math.atan2(move.x, move.z);
      let diff = targetFacing - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 12);
    }
    this.speed += (move.length() * baseSpeed - this.speed) * Math.min(1, dt * 10);

    // ---- 地形高度 ----
    const groundY = this.terrainFn ? this.terrainFn(this.pos.x, this.pos.z) : 0;

    // ---- 写入 group ----
    this.group.position.set(this.pos.x, groundY, this.pos.z);
    this.group.rotation.y = this.facing;
    this.shadow.position.set(.12, .18, .54);

    // 纪念碑谷式优雅微动: 上下浮动 + 行进时轻摇
    this._animTime += dt * (4 + this.speed * 0.6);
    const speedFactor = Math.min(1, this.speed / 2.5);
    const bob = Math.abs(Math.sin(this._animTime)) * 0.08 * speedFactor;
    this.group.position.y = groundY + bob;
    this.shadow.position.y = .18 - bob;
    // 行进时身体微倾/左右轻摆
    this.group.rotation.z = Math.sin(this._animTime) * 0.05 * speedFactor;
    // 帽尖整体随浮动 (已随 group, 无需额外)

    // ---- 相机第三人称 ----
    const camTarget = new THREE.Vector3(this.pos.x, groundY + 1.0, this.pos.z);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const offset = new THREE.Vector3(Math.sin(this.camYaw) * cp, sp, Math.cos(this.camYaw) * cp).multiplyScalar(this.camDist);
    this.camera.position.copy(camTarget).add(offset);
    this.camera.lookAt(camTarget.x, camTarget.y + (this.lookLift || 0), camTarget.z);
  }

  reset(x, z) {
    this.pos.set(x, 0, z);
    this.facing = 0;
    this.camYaw = 0;
    this.camPitch = 0.5;
    this.camDist = 8;
    this.update(0);
  }

  dispose() {
    this.detach();
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  }
}
