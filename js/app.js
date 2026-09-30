// app.js — 主控制器: 照片墙、上传转换、视图切换、3D 渲染循环

import * as THREE from 'three';
import { Storage } from './storage.js';
import { estimateDepth, depthToDataURL } from './depth-estimator.js';
import { SceneBuilder } from './scene-builder.js';
import { Character } from './character.js';
import { startPhotoMorph } from './conversion.js';

// ---------- 图像工具 ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// 取图像数据用于深度估计（按长边缩放，保持速度）
function getImageData(img, maxSide = 480) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * scale));
  const h = Math.max(2, Math.round(img.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function makeThumb(img, maxSide = 400) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', 0.82);
}

// Local edge extension for future portrait uploads; the curated 111 scene uses a full outpainted asset.
async function expandPortrait(img) {
  if (img.width >= img.height) return img;
  const h = Math.min(img.height, 1080), w = Math.round(h * 16 / 9);
  const centerW = Math.round(img.width * h / img.height), left = (w - centerW) / 2;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'blur(36px)'; ctx.drawImage(img, -42, -42, w + 84, h + 84); ctx.filter = 'none';
  const center = document.createElement('canvas'); center.width = w; center.height = h;
  const cc = center.getContext('2d'); cc.drawImage(img, left, 0, centerW, h);
  cc.globalCompositeOperation = 'destination-in';
  const fade = cc.createLinearGradient(left, 0, left + centerW, 0);
  fade.addColorStop(0, 'transparent'); fade.addColorStop(.08, 'black');
  fade.addColorStop(.92, 'black'); fade.addColorStop(1, 'transparent');
  cc.fillStyle = fade; cc.fillRect(left, 0, centerW, h);
  ctx.drawImage(center, 0, 0);
  return loadImage(canvas.toDataURL('image/jpeg', .9));
}

// 深度图 dataURL → Float32Array
async function depthFromDataURL(url, w, h) {
  const img = await loadImage(url);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const arr = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) arr[i] = d[i * 4] / 255;
  return arr;
}

// ---------- 主应用 ----------
const App = {
  scenes: [],          // 已存档场景列表
  three: null,         // { renderer, scene, camera, builder, character, clock, raf }
  activeScene: null,

  // ----- 滑杆映射: 立体深度 + 地面范围 -----
  depthFromSlider(v) { return 0.5 + (v / 100) * 5; },        // 立体深度 0.5 .. 5.5
  foldFromSlider(v) { return 0.15 + (v / 100) * 0.45; },     // 地面范围 0.15 .. 0.60

  async init() {
    this.wallEl = document.getElementById('photo-wall');
    this.wallView = document.getElementById('wall-view');
    this.sceneView = document.getElementById('scene-view');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingText = document.getElementById('loading-text');
    this.enterHint = document.getElementById('enter-hint');

    this.bindWallEvents();
    // One-time cleanup of the older demo scenes and archives.
    if (!localStorage.getItem('lakeside-only-v1')) {
      for (const scene of await Storage.getAll()) {
        if (scene.id !== 'default-111') await Storage.remove(scene.id);
      }
      localStorage.setItem('lakeside-only-v1', '1');
    }
    await this.seedDefaults();
    await this.loadScenes();
    this.renderWall();
  },

  // ----- 默认场景种子 -----
  async seedDefaults() {
    const all = await Storage.getAll();
    const has = (id) => all.some(s => s.id === id);
    const defs = [
      { id: 'default-111', file: 'assets/defaults/111.jpg', name: '111 · 夕照湖岸' },
    ];
    for (const d of defs) {
      if (has(d.id)) continue;
      try {
        this.loadingText && (this.loadingText.textContent = `初始化默认场景: ${d.name}…`);
        const img = await loadImage(d.file);
        await this.convertAndStore(img, { id: d.id, name: d.name, isDefault: true });
      } catch (e) {
        console.warn('默认场景加载失败', d.file, e);
      }
    }
  },

  async loadScenes() {
    this.scenes = await Storage.getAll();
    this.scenes.sort((a, b) => (a.isDefault ? -1 : 1) - (b.isDefault ? -1 : 1));
  },

  // ----- 转换并存档 -----
  async convertAndStore(img, { id, name, isDefault }) {
    img = isDefault ? img : await expandPortrait(img);
    const imgData = getImageData(img, 480);
    await new Promise(r => setTimeout(r, 0)); // 让出主线程，spinner 可显示
    const depth = estimateDepth(imgData);
    const depthURL = depthToDataURL(depth);
    const thumb = makeThumb(img, 480);
    // 全图存档（限制尺寸以免 IndexedDB 过大）
    const fullCv = document.createElement('canvas');
    const fs = Math.min(1, 1280 / Math.max(img.width, img.height));
    fullCv.width = Math.round(img.width * fs);
    fullCv.height = Math.round(img.height * fs);
    fullCv.getContext('2d').drawImage(img, 0, 0, fullCv.width, fullCv.height);
    const fullURL = fullCv.toDataURL('image/jpeg', 0.85);

    const record = {
      id, name, isDefault: !!isDefault,
      thumb, image: fullURL,
      depth: depthURL, depthW: depth.width, depthH: depth.height,
      settings: { depthStrength: 3.2, foldRatio: 0.4 },
      createdAt: Date.now(),
    };
    await Storage.put(record);
    return record;
  },

  // ----- 照片墙渲染 -----
  renderWall() {
    const wall = this.wallEl;
    wall.innerHTML = '';
    for (const s of this.scenes) {
      wall.appendChild(this.makeCard(s));
    }
    // 上传卡
    const up = document.createElement('div');
    up.className = 'scene-card upload-card';
    up.innerHTML = `<div class="plus">＋</div><div class="ul-text">上传新照片</div>`;
    up.addEventListener('click', () => document.getElementById('file-input').click());
    wall.appendChild(up);
  },

  makeCard(s) {
    const card = document.createElement('div');
    card.className = 'scene-card' + (s.isDefault ? ' default' : '');
    card.innerHTML = `
      <img src="${s.thumb}" alt="${s.name}" loading="lazy" />
      <div class="card-overlay">
        <div>
          <div class="card-name">${s.name}</div>
          <div class="card-meta">${s.isDefault ? '默认场景' : '已存档'} · 点击进入</div>
        </div>
        <div class="enter-tag">进入 3D ›</div>
      </div>`;
    card.addEventListener('click', () => this.enterScene(s.id));
    return card;
  },

  bindWallEvents() {
    document.getElementById('upload-btn').addEventListener('click', () =>
      document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', e =>
      this.handleFiles(e.target.files));
    document.querySelector('.wall-nav.prev').addEventListener('click', () =>
      this.scrollWall(-1));
    document.querySelector('.wall-nav.next').addEventListener('click', () =>
      this.scrollWall(1));
  },

  scrollWall(dir) {
    const wall = this.wallEl;
    const card = wall.querySelector('.scene-card');
    const step = card ? card.offsetWidth + 28 : 360;
    wall.scrollBy({ left: dir * step * 1.5, behavior: 'smooth' });
  },

  async handleFiles(files) {
    if (!files || !files.length) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      // 临时插入 processing 卡
      const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const card = document.createElement('div');
      card.className = 'scene-card processing';
      card.innerHTML = `
        <div class="proc-bar">
          <div class="spinner"></div>
          <div style="font-size:13px;color:#b8c0d0;">生成中…</div>
        </div>`;
      const wall = this.wallEl;
      wall.insertBefore(card, wall.lastElementChild); // 插在上传卡前面
      try {
        const url = await fileToDataURL(file);
        const img = await loadImage(url);
        const name = file.name.replace(/\.[^.]+$/, '') || '未命名';
        const id = 'scene-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const rec = await this.convertAndStore(img, { id, name, isDefault: false });
        this.scenes.push(rec);
      } catch (e) {
        console.error(e);
        alert('转换失败: ' + (e?.message || e));
      } finally {
        card.remove();
        this.renderWall();
      }
    }
  },

  // ----- 进入 3D 场景 -----
  async enterScene(id) {
    if (this._entering) return;
    this._entering = true;
    const token = this._enterToken = (this._enterToken || 0) + 1;
    const previewRecord = this.scenes.find(scene => scene.id === id);
    const previewImage = id === 'default-111' ? 'assets/defaults/111-wide.png' : previewRecord?.image;
    if (previewImage) {
      this.loadingOverlay.querySelector('.conversion-photo').src = previewImage;
      this.loadingOverlay.querySelector('.conversion-backdrop').style.backgroundImage = `url("${previewImage}")`;
    }
    this.sceneView.classList.add('is-converting');
    this.loadingOverlay.classList.remove('failed', 'converting', 'morphing');
    this.loadingOverlay.classList.add('preparing');
    this.loadingOverlay.classList.remove('hidden');
    this.loadingOverlay.setAttribute('aria-hidden', 'false');
    this.showSceneView(true);
    this.loadingText.textContent = '读取照片';
    this.enterHint.classList.add('hidden');

    try {
      const rec = await Storage.get(id);
      if (!rec) throw new Error('场景不存在');
      if (token !== this._enterToken) return;
      this.activeScene = rec;
      const transitionImage = rec.id === 'default-111' ? 'assets/defaults/111-wide.png' : rec.image;
      this.loadingOverlay.querySelector('.conversion-photo').src = transitionImage;
      this.loadingOverlay.querySelector('.conversion-backdrop').style.backgroundImage = `url("${transitionImage}")`;
      this.loadingOverlay.classList.add('preparing');

      document.getElementById('scene-title').textContent = rec.name;
      const ds = rec.settings?.depthStrength ?? 3.2;
      const fr = rec.settings?.foldRatio ?? 0.4;
      document.getElementById('depth-slider').value = Math.round((ds - 0.5) / 5 * 100);
      document.getElementById('fold-slider').value = Math.round((fr - 0.15) / 0.45 * 100);

      const [photo] = await Promise.all([loadImage(transitionImage), this.buildThree(rec)]);
      if (token !== this._enterToken) { this.disposeThree(); return; }
      this.loadingText.textContent = '照片正在立起来';
      this.loadingOverlay.classList.remove('preparing', 'converting', 'morphing');
      void this.loadingOverlay.offsetWidth;
      try { this._stopMorph = startPhotoMorph(this.loadingOverlay.querySelector('.conversion-mesh'), photo); }
      catch (error) { console.warn('空间变换动画不可用', error); }
      this.loadingOverlay.classList.add('converting', 'morphing');
      this._transitionTimers = [
        setTimeout(() => { if (token === this._enterToken) this.loadingText.textContent = '拉开远近空间'; }, 1000),
        setTimeout(() => { if (token === this._enterToken) this.loadingText.textContent = '走进照片'; }, 2000),
      ];
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (token !== this._enterToken) { this.disposeThree(); return; }
      this._transitionTimers.forEach(clearTimeout);
      // Keep the deformed frame under the fade. Removing morphing here would
      // briefly restore the original still photo and create a visible flash.
      this.loadingOverlay.classList.add('hidden');
      this.loadingOverlay.setAttribute('aria-hidden', 'true');
      this.sceneView.classList.remove('is-converting');
      this.three?.character.setEnabled(true);
      this._transitionTimers.push(setTimeout(() => {
        if (token !== this._enterToken) return;
        this._stopMorph?.(); this._stopMorph = null;
        this.loadingOverlay.classList.remove('morphing', 'converting', 'preparing');
      }, 450));
    } catch (e) {
      console.error(e);
      this._lastError = e?.stack || String(e);
      this.disposeThree();
      this._stopMorph?.(); this._stopMorph = null;
      this.loadingOverlay.classList.remove('converting', 'morphing', 'preparing');
      this.loadingOverlay.classList.add('failed');
      this.sceneView.classList.remove('is-converting');
      this.loadingText.textContent = '场景生成失败: ' + (e?.message || e);
    } finally {
      this._entering = false;
    }
  },

  async buildThree(rec) {
    await new Promise(r => setTimeout(r, 30));
    const isLakeside = rec.id === 'default-111';
    const img = await loadImage(isLakeside ? 'assets/defaults/111-wide.png' : rec.image);
    const depth = isLakeside
      ? { data: new Float32Array(1), width: 1, height: 1 }
      : { data: await depthFromDataURL(rec.depth, rec.depthW, rec.depthH), width: rec.depthW, height: rec.depthH };
    const grassImage = isLakeside ? await loadImage('assets/defaults/grass-meadow.png') : null;

    this.disposeThree();

    const canvas = document.getElementById('scene-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = rec.id === 'default-111';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / canvas.clientHeight, 0.1, 5000);
    // Preserve sharp nearby grass and cabins while distant ridges and sky soften.
    const focus = rec.id === 'default-111' ? (() => {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y) });
      const uniforms = { tColor: { value: target.texture }, tDepth: { value: target.depthTexture }, resolution: { value: size }, near: { value: camera.near }, far: { value: camera.far } };
      const material = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
        fragmentShader: `uniform sampler2D tColor,tDepth; uniform vec2 resolution; uniform float near,far; varying vec2 vUv;
          void main(){float d=texture2D(tDepth,vUv).x;
            float linearDepth=(near*far)/(far-d*(far-near));
            float blur=smoothstep(48.0,180.0,linearDepth)*3.2*(1.0-smoothstep(.9995,1.0,d));
            vec2 stepUV=blur/resolution;
            vec3 color=texture2D(tColor,vUv).rgb*4.0;
            color+=texture2D(tColor,vUv+stepUV*vec2(1.,0.)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(-1.,0.)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(0.,1.)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(0.,-1.)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(.7,.7)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(-.7,.7)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(.7,-.7)).rgb;
            color+=texture2D(tColor,vUv+stepUV*vec2(-.7,-.7)).rgb;
            gl_FragColor=vec4(color/12.0,1.0);
            #include <colorspace_fragment>
          }` });
      const pass = new THREE.Scene();
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      pass.add(quad);
      return { target, material, quad, pass, camera: new THREE.Camera() };
    })() : null;

    const builder = new SceneBuilder();
    const ds = rec.settings?.depthStrength ?? 3.2;
    const fr = rec.settings?.foldRatio ?? 0.4;
    const { group, meta, fogColor } = builder.build(img, depth, { depthStrength: ds, foldRatio: fr, sceneId: rec.id, grassImage });
    scene.add(group);

    // 雾: 两侧过渡到天空穹顶, 无硬边界
    scene.fog = new THREE.Fog(fogColor.getHex(), rec.id === 'default-111' ? 160 : 16, rec.id === 'default-111' ? 280 : 52);
    scene.background = fogColor.clone();

    // 灯光: 半球光(天空→地面) + 柔和方向光
    const hemi = new THREE.HemisphereLight(rec.id === 'default-111' ? 0xc8c9c1 : fogColor.getHex(), 0x384033, rec.id === 'default-111' ? 1.15 : 0.95);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(rec.id === 'default-111' ? 0xffc575 : 0xffffff, rec.id === 'default-111' ? 1.3 : 0.6);
    dir.position.set(rec.id === 'default-111' ? -4 : -12, 20, rec.id === 'default-111' ? -35 : 7);
    if (rec.id === 'default-111') { dir.castShadow = true; dir.shadow.mapSize.set(2048, 2048); dir.shadow.camera.left = -70; dir.shadow.camera.right = 70; dir.shadow.camera.top = 70; dir.shadow.camera.bottom = -70; dir.shadow.normalBias = .025; }
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xb0c4ff, 0.25);
    dir2.position.set(5, 6, -5);
    scene.add(dir2);

    // 角色
    const character = new Character(camera, canvas);
    character.setBounds(meta.bounds);
    character.setTerrain(meta.heightAt);
    const startZ = rec.id === 'default-111' ? 45 : Math.min(meta.bounds.maxZ, Math.max(meta.bounds.minZ + 1, meta.bounds.maxZ * 0.7));
    character.reset(0, startZ);
    if (rec.id === 'default-111') { character.camPitch = 0.38; character.camDist = 13; character.lookLift = 1.8; character.update(0); }
    character.attach();
    scene.add(character.group);

    const clock = new THREE.Clock();
    let raf;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      character.update(dt);
      builder.update(dt);
      if (focus) {
        renderer.setRenderTarget(focus.target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(focus.pass, focus.camera);
      } else renderer.render(scene, camera);
    };
    loop();

    // resize
    const onResize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      if (focus) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        focus.target.setSize(size.x, size.y);
        focus.material.uniforms.resolution.value.copy(size);
      }
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    this.three = { renderer, scene, camera, builder, character, clock, raf, onResize, img, depth, meta, focus };

    // 绑定场景内控件
    this.bindSceneControls(rec);
  },

  bindSceneControls(rec) {
    document.querySelector('.control-panel').classList.toggle('lakeside-controls', rec.id === 'default-111');
    const depthSlider = document.getElementById('depth-slider');
    const foldSlider = document.getElementById('fold-slider');
    const regenBtn = document.getElementById('regen-btn');

    let rebuildTimer = null;
    const schedule = () => {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => this.rebuildScene(rec), 120);
    };
    depthSlider.oninput = schedule;
    foldSlider.oninput = schedule;
    regenBtn.textContent = rec.id === 'default-111' ? '回到起点' : '↻ 重生成';
    regenBtn.title = rec.id === 'default-111' ? '回到湖岸起点' : '重新生成深度';
    regenBtn.onclick = rec.id === 'default-111'
      ? () => { this.three?.character.reset(0, 45); this.three.character.camPitch = 0.38; this.three.character.camDist = 13; this.three.character.lookLift = 1.8; this.three.character.update(0); }
      : () => this.rebuildScene(rec, true);

    document.getElementById('back-btn').onclick = () => this.exitScene();

    // 点击画布激活操控
    const canvas = document.getElementById('scene-canvas');
    const onCanvasDown = () => {
      if (this.three) this.three.character.setEnabled(true);
      this.enterHint.classList.add('hidden');
    };
    canvas.addEventListener('pointerdown', onCanvasDown);
    this._onCanvasDown = onCanvasDown;
  },

  async rebuildScene(rec, force = false) {
    if (!this.three) return;
    const ds = this.depthFromSlider(+document.getElementById('depth-slider').value);
    const fr = this.foldFromSlider(+document.getElementById('fold-slider').value);
    rec.settings = { depthStrength: ds, foldRatio: fr };
    await Storage.put(rec);

    const { scene, builder, character, img, depth } = this.three;
    if (builder.group) scene.remove(builder.group);
    const res = builder.build(img, depth, { depthStrength: ds, foldRatio: fr, sceneId: rec.id });
    scene.add(res.group);
    character.setBounds(res.meta.bounds);
    character.setTerrain(res.meta.heightAt);
    scene.fog.color = res.fogColor;
    scene.background = res.fogColor.clone();
    this.three.meta = res.meta;
  },

  exitScene() {
    this._enterToken = (this._enterToken || 0) + 1;
    this._transitionTimers?.forEach(clearTimeout);
    this._stopMorph?.(); this._stopMorph = null;
    this.loadingOverlay.classList.remove('converting', 'morphing', 'preparing');
    this.loadingOverlay.classList.add('hidden');
    this.loadingOverlay.setAttribute('aria-hidden', 'true');
    this.sceneView.classList.remove('is-converting');
    this.disposeThree();
    this.showSceneView(false);
    this.activeScene = null;
  },

  disposeThree() {
    if (!this.three) return;
    const t = this.three;
    cancelAnimationFrame(t.raf);
    window.removeEventListener('resize', t.onResize);
    const canvas = document.getElementById('scene-canvas');
    if (this._onCanvasDown) canvas.removeEventListener('pointerdown', this._onCanvasDown);
    t.character?.dispose();
    t.builder?.dispose();
    t.focus?.quad.geometry.dispose();
    t.focus?.material.dispose();
    t.focus?.target.dispose();
    t.renderer?.dispose();
    this.three = null;
  },

  showSceneView(show) {
    if (show) {
      this.wallView.classList.remove('active');
      this.sceneView.classList.add('active');
    } else {
      this.sceneView.classList.remove('active');
      this.wallView.classList.add('active');
    }
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
