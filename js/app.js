// app.js — 主控制器: 照片墙、上传转换、视图切换、3D 渲染循环

import * as THREE from 'three';
import { Storage } from './storage.js';
import { estimateDepth, depthToDataURL } from './depth-estimator.js';
import { SceneBuilder } from './scene-builder.js';
import { Character } from './character.js';
import { DEFAULT_STORY, parseStory, placeNPCs, StoryNPCs } from './story-npcs.js';
import { startPhotoMorph } from './conversion.js';
import { reconstruct, serviceUrl, refreshMarble } from './reconstruction.js';

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
    this.bindServiceSettings();
    this.bindStoryControls();
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
  async convertAndStore(img, { id, name, isDefault, onProgress }) {

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
    if(!isDefault){
      const result=await reconstruct(fullURL,{name,onProgress,onJob:async job=>{record.marbleJob=job;await Storage.put(record);}});
      record.plan=result.plan;record.world=result.world;record.provenance=result.provenance;delete record.marbleJob;
    }
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
      <img src="${s.thumb}" alt="照片" loading="lazy" />
      <div class="card-overlay">
        <div>
          <div class="card-name"></div>
          <div class="card-meta">${s.isDefault ? '默认场景' : '已存档'} · 点击进入</div>
        </div>
        <div class="enter-tag">进入 3D ›</div>
      </div>`;
    card.querySelector('.card-name').textContent = s.name;
    card.querySelector('img').alt = s.name;
    card.querySelector('.card-meta').textContent = s.isDefault ? '默认场景 · 点击进入' : (s.world ? 'Marble 三维世界 · 点击进入' : s.marbleJob ? '生成任务已保存 · 点击继续' : s.plan ? '近似三维重建 · 点击进入' : '待升级 · 点击重新分析');
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
        const rec = await this.convertAndStore(img, { id, name, isDefault: false, onProgress:text=>{card.querySelector('.proc-bar div:last-child').textContent=text;} });
        this.scenes.push(rec);
      } catch (e) {
        console.error(e);
        alert('转换失败: ' + (e?.message || e));
      } finally {
        card.remove();
        await this.loadScenes();
        this.renderWall();
      }
    }
    document.getElementById('file-input').value = '';
  },

  bindServiceSettings() {
    const dialog=document.getElementById('service-dialog'),input=document.getElementById('service-url'),status=document.getElementById('service-status');
    document.getElementById('service-btn').onclick=()=>{input.value=serviceUrl();status.textContent='';dialog.showModal();};
    document.getElementById('service-close').onclick=()=>dialog.close();
    document.getElementById('service-save').onclick=async()=>{
      try {
        const url=new URL(input.value);
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('请输入不含密钥的 HTTP 或 HTTPS 后端地址');
        const base=url.href.replace(/\/$/,'');
        const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(8000)});
        const health=await response.json();if(!response.ok)throw new Error('转换服务未响应');
        localStorage.setItem('scene-service-url',base);
        status.textContent=health.configured?`已连接 ${health.provider==='marble'?'Marble':'视觉模型'}，可以上传照片。`:`已连接后端；请配置 ${health.provider==='marble'?'MARBLE_API_KEY':'视觉模型'} 后重启服务。`;
      }catch(e){status.textContent=e.message||'连接失败';}
    };
  },

  bindStoryControls() {
    const dialog=document.getElementById('story-dialog'),input=document.getElementById('story-input'),save=document.getElementById('story-save'),status=document.getElementById('story-status');
    document.getElementById('story-btn').onclick=()=>{
      if(!this.three?.character || this._entering)return;
      this._storyWasEnabled=this.three.character._enabled;this.three.character.setEnabled(false);this.three.character.keys={};
      input.value=this.activeScene.storyQuest?.text || DEFAULT_STORY;status.textContent='';dialog.showModal();this.previewStory();input.focus();
    };
    document.getElementById('story-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{if(this.three&&!this._entering){this.three.character.keys={};this.three.character.setEnabled(this._storyWasEnabled);}});
    input.addEventListener('input',()=>this.previewStory());
    save.onclick=async()=>{
      const rec=this.activeScene,t=this.three;if(!rec||!t)return;
      save.disabled=true;
      try {
        const text=input.value.trim(),npcs=placeNPCs(parseStory(text),t.meta,rec);
        const quest={text,npcs,collected:[],createdAt:Date.now()};
        await this._questSave;await Storage.put({...rec,storyQuest:quest});
        if(this.three!==t||this.activeScene!==rec)return;
        rec.storyQuest=quest;await this.installStory(rec);dialog.close();this.questToast('三位新朋友已来到场景。靠近他们，收集三颗星。');
      }catch(e){status.textContent=e.message||'故事保存失败，请重试';}
      finally{save.disabled=false;}
    };
    document.getElementById('quest-replay').onclick=async()=>{
      const rec=this.activeScene,button=document.getElementById('quest-replay');if(!rec)return;
      button.disabled=true;
      try {await this._questSave;const quest={...rec.storyQuest,collected:[]};await Storage.put({...rec,storyQuest:quest});if(this.activeScene!==rec)return;rec.storyQuest=quest;await this.installStory(rec);this.questToast('星星重新亮起，出发吧。');}
      catch(e){this.questToast('进度保存失败，请重试。');}finally{button.disabled=false;}
    };
  },

  previewStory() {
    const preview=document.getElementById('story-preview'),status=document.getElementById('story-status'),save=document.getElementById('story-save');preview.replaceChildren();
    try {
      const npcs=parseStory(document.getElementById('story-input').value);
      const placed=placeNPCs(npcs,this.three.meta,this.activeScene);
      for(const npc of placed){const card=document.createElement('div');card.className='story-npc';const name=document.createElement('strong');name.textContent=npc.name;const where=document.createElement('span');where.textContent=({tree:'树下',house:'房屋旁',shore:'岸边',nearby:'附近'}[npc.location])+' · '+(npc.placement==='出生点附近'?'起点周边':'场景地物')+' · 1 星';card.append(name,where);preview.append(card);}
      status.textContent='三位 NPC 已识别，确认后放入当前场景。';save.disabled=false;
    }catch(e){status.textContent=e.message;save.disabled=true;}
  },

  async installStory(rec) {
    const t=this.three;if(!t?.character)return;
    if(!rec.storyQuest){
      const text=rec.id==='default-111'?DEFAULT_STORY:'起点附近有位旅人。前方遇到了小猫。路旁见到了小兔。';
      const quest={text,npcs:placeNPCs(parseStory(text),t.meta,rec),collected:[],createdAt:Date.now()};
      await Storage.put({...rec,storyQuest:quest});if(this.three!==t)return;rec.storyQuest=quest;
    }
    t.npcs?.dispose();
    t.npcs=new StoryNPCs(t.scene,t.meta,rec.storyQuest.npcs,rec.storyQuest.collected,npc=>{
      if(this.three!==t || rec.storyQuest.collected.includes(npc.id))return;
      rec.storyQuest.collected.push(npc.id);this.renderQuest();
      const count=rec.storyQuest.collected.length;
      this.questToast(count===3?'三星任务完成！你找到了照片里的三位朋友。':`遇见${npc.name}，收集一颗星 · ${count}/3`);
      const snapshot=structuredClone(rec);
      this._questSave=(this._questSave||Promise.resolve()).then(()=>Storage.put(snapshot)).catch(()=>{if(this.activeScene===rec)this.questToast('本机存档失败，当前探索仍可继续。');});
    });
    this.renderQuest();
  },

  renderQuest() {
    const rec=this.activeScene,t=this.three,quest=rec?.storyQuest;if(!quest||!t?.character)return;
    const count=quest.collected.length,stars=document.getElementById('quest-stars');stars.textContent=Array.from({length:3},(_,i)=>i<count?'★':'☆').join(' ');stars.setAttribute('aria-label',`已收集 ${count} / 3 颗星`);
    document.getElementById('quest-replay').hidden=count!==3;
    if(stars.dataset.count!==undefined && count>Number(stars.dataset.count)){
      stars.classList.remove('star-collected');void stars.offsetWidth;stars.classList.add('star-collected');
    }
    stars.dataset.count=String(count);
  },

  questToast(text) {
    const el=document.getElementById('quest-toast');el.textContent=text;// Keep routine feedback in the live region; the visible feedback is the three stars.
    clearTimeout(this._toastTimer);this._toastTimer=setTimeout(()=>{el.textContent='';},3500);
  },

  // ----- 进入 3D 场景 -----
  async enterScene(id) {
    if (this._entering) return;
    this._entering = true;
    const token = this._enterToken = (this._enterToken || 0) + 1;
    this._enterAbort=new AbortController();
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
    document.getElementById('back-btn').onclick=()=>this.exitScene();
    this.loadingText.textContent = '读取照片';
    this.enterHint.classList.add('hidden');

    try {
      await this._questSave;
      const rec = await Storage.get(id);
      if (!rec) throw new Error('场景不存在');
      if (token !== this._enterToken) return;
      if (rec.id !== 'default-111' && !rec.plan && !rec.world) {
        this.loadingText.textContent = '正在重新分析旧照片';
        const result = await reconstruct(rec.image,{name:rec.name,job:rec.marbleJob,signal:this._enterAbort.signal,onJob:async job=>{rec.marbleJob=job;await Storage.put(rec);},onProgress:text=>{if(token===this._enterToken)this.loadingText.textContent=text;}});
        if(token !== this._enterToken) return;
        rec.plan = result.plan; rec.world = result.world; rec.provenance = result.provenance;delete rec.marbleJob;
        await Storage.put(rec);
        Object.assign(this.scenes.find(s=>s.id===id), rec);
      }
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
      try { this.three.formationStarted = performance.now();
        this._stopMorph = startPhotoMorph(this.loadingOverlay.querySelector('.conversion-mesh'), photo, rec.plan); }
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
      if(token !== this._enterToken)return;
      console.error(e);
      this._lastError = e?.stack || String(e);
      this.disposeThree();
      this._stopMorph?.(); this._stopMorph = null;
      this.loadingOverlay.classList.remove('converting', 'morphing', 'preparing');
      this.loadingOverlay.classList.add('failed');
      this.sceneView.classList.remove('is-converting');
      this.loadingText.textContent = '场景生成失败: ' + (e?.message || e);
    } finally {
      if(token===this._enterToken)this._entering = false;
    }
  },

  async buildThree(rec) {
    const buildToken=this._enterToken;
    await new Promise(r => setTimeout(r, 30));
    const isLakeside = rec.id === 'default-111';
    const img = await loadImage(isLakeside ? 'assets/defaults/111-wide.png' : rec.image);
    const depth = isLakeside
      ? { data: new Float32Array(1), width: 1, height: 1 }
      : { data: await depthFromDataURL(rec.depth, rec.depthW, rec.depthH), width: rec.depthW, height: rec.depthH };
    const grassImage = await loadImage('assets/defaults/grass-meadow.png');

    if(buildToken!==this._enterToken)throw new Error('场景加载已取消');
    this.disposeThree();

    const canvas = document.getElementById('scene-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / canvas.clientHeight, 0.1, 5000);
    // Preserve sharp nearby grass and cabins while distant ridges and sky soften.
    const focus = rec.world ? null : (() => {
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
    })();

    const builder = new SceneBuilder();
    this.three={renderer,scene,camera,builder,focus};
    const ds = rec.settings?.depthStrength ?? 3.2;
    const fr = rec.settings?.foldRatio ?? 0.4;
    let result;
    if(rec.world){
      // Saved URLs can expire. Refresh the same world, never regenerate it.
      rec.world=await refreshMarble(rec.world);await Storage.put(rec);
      result=await builder.buildMarble(rec.world,renderer);
    }else result=builder.build(img,depth,{depthStrength:ds,foldRatio:fr,sceneId:rec.id,grassImage,plan:rec.plan});
    if(buildToken!==this._enterToken){builder.dispose();renderer.dispose();throw new Error('场景加载已取消');}
    const {group,meta,fogColor}=result;
    scene.add(group);

    // 雾: 两侧过渡到天空穹顶, 无硬边界
    scene.fog = rec.world ? null : new THREE.Fog(fogColor.getHex(), 160, 380);
    scene.background = fogColor.clone();

    // 灯光: 半球光(天空→地面) + 柔和方向光
    const hemi = new THREE.HemisphereLight(rec.id === 'default-111' ? 0xc8c9c1 : fogColor.getHex(), 0x384033, rec.id === 'default-111' ? 1.15 : 0.95);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(rec.id === 'default-111' ? 0xffc575 : 0xffffff, rec.id === 'default-111' ? 1.3 : 0.6);
    dir.position.set(rec.id === 'default-111' ? -4 : -12, 20, rec.id === 'default-111' ? -35 : 7);
    if (rec.id === 'default-111') { dir.castShadow = true; dir.shadow.mapSize.set(2048, 2048); dir.shadow.camera.left = -70; dir.shadow.camera.right = 70; dir.shadow.camera.top = 70; dir.shadow.camera.bottom = -70; dir.shadow.normalBias = .025; }
    scene.add(dir,dir.target);
    const dir2 = new THREE.DirectionalLight(0xb0c4ff, 0.25);
    dir2.position.set(5, 6, -5);
    scene.add(dir2);
    if(rec.plan){
      const l=rec.plan.lighting;hemi.color.set(l.ambientColor);hemi.intensity=l.ambientIntensity;
      dir.color.set(l.color);dir.intensity=l.intensity;dir.position.set(...l.sunDirection).multiplyScalar(100);
      dir2.intensity=.08;dir.castShadow=true;dir.shadow.mapSize.set(2048,2048);
      Object.assign(dir.shadow.camera,{left:-90,right:90,top:90,bottom:-90,far:500});dir.shadow.normalBias=.025;
    }

    if(rec.world){dir.castShadow=true;dir.shadow.mapSize.set(1024,1024);Object.assign(dir.shadow.camera,{left:-20,right:20,top:20,bottom:-20,far:100});dir.shadow.normalBias=.02;}

    // 角色
    const character = new Character(camera, canvas);
    character.setBounds(meta.bounds);
    character.setTerrain(meta.heightAt);
    character.setWalkable(meta.canWalk);
    const startZ = rec.id === 'default-111' ? 45 : Math.min(meta.bounds.maxZ, Math.max(meta.bounds.minZ + 1, meta.bounds.maxZ * 0.7));
    character.reset(0, startZ);
    if(meta.spawn){character.reset(meta.spawn.x,meta.spawn.z);character.camYaw=meta.spawn.yaw;character.camPitch=meta.spawn.pitch;character.camDist=meta.spawn.distance;character.lookLift=rec.world?.25:1.8;character.update(0);}
    if (rec.id === 'default-111') { character.camPitch = 0.38; character.camDist = 13; character.lookLift = 1.8; character.update(0); }
    character.attach();
    scene.add(character.group);

    const clock = new THREE.Clock();
    let raf;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if(this.three?.renderer === renderer) this.three.raf = raf;
      const dt = clock.getDelta();
      character.update(dt);
      builder.update(dt);
      this.three?.npcs?.update(dt, character);
      this._questTick=(this._questTick||0)+dt;
      if(this._questTick>.25){this._questTick=0;this.renderQuest();}
      if(rec.plan){dir.target.position.copy(character.group.position);dir.position.copy(dir.target.position).addScaledVector(new THREE.Vector3(...rec.plan.lighting.sunDirection).normalize(),100);}
      if(this.three?.formationStarted){const p=Math.min(1,(performance.now()-this.three.formationStarted)/3000);builder.setFormation(p*p*(3-2*p));}
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

    this.three = { renderer, scene, camera, builder, character, clock, raf, onResize, img, depth, meta, focus, grassImage };

    await this.installStory(rec);
    // 绑定场景内控件
    this.bindSceneControls(rec);
  },

  bindSceneControls(rec) {
    document.querySelector('.control-panel').classList.add('lakeside-controls');
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
    regenBtn.textContent = '回到起点';
    regenBtn.title = '回到场景起点';
    regenBtn.onclick = () => {
      const t=this.three;if(!t)return;
      const sp=t.meta.spawn || {x:0,z:45,yaw:0,pitch:.38,distance:13};
      t.meta.resetGround?.();t.character.reset(sp.x,sp.z);t.character.camYaw=sp.yaw;t.character.camPitch=sp.pitch;t.character.camDist=sp.distance;t.character.lookLift=rec.world?.25:1.8;t.character.update(0);
    };

    document.getElementById('back-btn').onclick = () => this.exitScene();

    // 点击画布激活操控
    const canvas = document.getElementById('scene-canvas');
    const onCanvasDown = () => {
      if (this.three && !this._entering && !document.getElementById('story-dialog').open) this.three.character.setEnabled(true);
      this.enterHint.classList.add('hidden');
    };
    canvas.addEventListener('pointerdown', onCanvasDown);
    this._onCanvasDown = onCanvasDown;
  },

  async rebuildScene(rec, force = false) {
    if (!this.three || rec.world) return;
    const ds = this.depthFromSlider(+document.getElementById('depth-slider').value);
    const fr = this.foldFromSlider(+document.getElementById('fold-slider').value);
    rec.settings = { depthStrength: ds, foldRatio: fr };
    await Storage.put(rec);

    const { scene, builder, character, img, depth } = this.three;
    if (builder.group) scene.remove(builder.group);
    const res = builder.build(img, depth, { depthStrength: ds, foldRatio: fr, sceneId: rec.id, plan: rec.plan, grassImage: this.three.grassImage });
    scene.add(res.group);
    character.setBounds(res.meta.bounds);
    character.setTerrain(res.meta.heightAt);
    character.setWalkable(res.meta.canWalk);
    scene.fog.color = res.fogColor;
    scene.background = res.fogColor.clone();
    this.three.meta = res.meta;
    await this.installStory(rec);
  },

  exitScene() {
    this._enterToken = (this._enterToken || 0) + 1;
    this._entering=false;this._enterAbort?.abort();
    this._transitionTimers?.forEach(clearTimeout);
    this._stopMorph?.(); this._stopMorph = null;
    this.loadingOverlay.classList.remove('converting', 'morphing', 'preparing');
    this.loadingOverlay.classList.add('hidden');
    this.loadingOverlay.setAttribute('aria-hidden', 'true');
    this.sceneView.classList.remove('is-converting');
    document.getElementById('story-dialog').close();
    clearTimeout(this._toastTimer);
    document.getElementById('quest-toast').classList.remove('visible');
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
    t.npcs?.dispose();
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
