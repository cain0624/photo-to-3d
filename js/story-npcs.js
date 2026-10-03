import * as THREE from 'three';

export const DEFAULT_STORY = '在树下见到了松鼠。房子旁边有个砍树大叔。湖边有螃蟹。';
const kinds = [
  ['squirrel', /松鼠/, '松鼠'], ['woodcutter', /砍树|伐木|樵夫/, '砍树大叔'],
  ['crab', /螃蟹|蟹/, '螃蟹'], ['rabbit', /兔/, '小兔'], ['cat', /猫/, '小猫'],
  ['dog', /狗|犬/, '小狗'], ['person', /大叔|女孩|男孩|老人|旅人|朋友|小孩|爷爷|奶奶/, null],
];
// ponytail: browser keyword parsing, not an AI story model. Unknown names use a traveler model.
export function parseStory(text) {
  if (!text.trim() || text.length > 1000) throw new Error('请输入 1–1000 字的故事。');
  const clauses = text.replace(/和(?=[^。！？；\n，,]{0,16}(?:有|见到|遇到|遇见))/g,'。').split(/[。！？!?；;\n，,]+/).map(x=>x.trim()).filter(Boolean);
  const npcs = clauses.map((clause, i) => {
    const found = kinds.find(([,pattern])=>pattern.test(clause));
    const kind = found?.[0] || 'person';
    const name = found?.[2] || clause.replace(/^.*?(?:见到了?|遇见了?|遇到了?|有(?:一位|一个|位|个)?)/, '').replace(/[在到].*$/, '').trim().slice(0,12) || '故事旅人';
    const location = /树下|树林|树旁|树边|树荫/.test(clause) && !/房|屋/.test(clause) ? 'tree' : /房|屋|建筑/.test(clause) ? 'house' : /湖|海|河|岸|水边/.test(clause) ? 'shore' : 'nearby';
    return { id: `npc-${i}`, kind, name, location, story: clause };
  });
  if (npcs.length !== 3) throw new Error('每个任务需要三位 NPC。请用三句话或三行分别描述一位角色和位置。');
  return npcs;
}

export function placeNPCs(npcs, meta, record) {
  const spawn = meta.spawn || {x:0,z:45};
  const b=meta.bounds, anchors=meta.storyAnchors || {};
  if(record.plan) {
    const nearest=objects=>objects.sort((a,c)=>Math.hypot(a.x-spawn.x,a.z-spawn.z)-Math.hypot(c.x-spawn.x,c.z-spawn.z))[0];
    const tree=nearest(record.plan.objects.filter(o=>o.kind==='tree'));
    const house=nearest(record.plan.objects.filter(o=>o.kind==='building'));
    if(tree)anchors.tree={x:tree.x+tree.width*.6+1,z:tree.z+1};
    if(house)anchors.house={x:house.x+house.width*.5+2,z:house.z+house.depth*.5+2};
    const bank=record.plan.waters.flatMap(w=>w.polygon.map(([x,z])=>({x,z}))).sort((a,c)=>Math.hypot(a.x-spawn.x,a.z-spawn.z)-Math.hypot(c.x-spawn.x,c.z-spawn.z))[0];
    if(bank)anchors.shore=bank;
  }
  const placed=[];
  for(let i=0;i<npcs.length;i++) {
    const npc=npcs[i],anchor=anchors[npc.location] || {x:spawn.x+Math.sin(i*2.1)*8,z:spawn.z-7+Math.cos(i*2.1)*4};
    let point=null;
    for(let radius=0;radius<=30&&!point;radius+=.75)for(let a=0;a<16;a++) {
      const x=anchor.x+radius*Math.cos(a*Math.PI/8),z=anchor.z+radius*Math.sin(a*Math.PI/8);
      if(x<b.minX+.5||x>b.maxX-.5||z<b.minZ+.5||z>b.maxZ-.5)continue;
      if(placed.some(p=>Math.hypot(p.x-x,p.z-z)<4))continue;
      if(!meta.npcGround && meta.canWalk && !meta.canWalk(x,z))continue;
      const y=meta.npcGround?meta.npcGround(x,z):meta.heightAt(x,z);if(!Number.isFinite(y))continue;
      point={x,z,y};break;
    }
    if(!point)throw new Error('没有找到三处可到达的位置，请调整故事的位置描述。');
    placed.push({...npc,...point,placement:anchors[npc.location]?'场景位置':'出生点附近'});
  }
  return placed;
}

function npcModel(kind) {
  const g=new THREE.Group(),materials={};
  const material=color=>materials[color] ||= new THREE.MeshStandardMaterial({color,roughness:.9,flatShading:true});
  const part=(geo,color,x,y,z,sx=1,sy=1,sz=1)=>{const m=new THREE.Mesh(geo,material(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=m.receiveShadow=true;g.add(m);return m;};
  const ball=(color,x,y,z,sx,sy,sz)=>part(new THREE.SphereGeometry(1,12,8),color,x,y,z,sx,sy,sz);
  const eyes=(y,z,spread)=>{for(const s of [-1,1])ball('#24211d',s*spread,y,z,.045,.055,.045);};
  if(kind==='woodcutter'||kind==='person') {
    part(new THREE.CylinderGeometry(.32,.4,.85,10),kind==='woodcutter'?'#a55339':'#537fa0',0,.95,0);
    ball('#d8aa80',0,1.66,0,.26,.29,.25);eyes(1.69,.23,.10);
    for(const s of [-1,1]){part(new THREE.CylinderGeometry(.12,.13,.6,8),'#494339',s*.2,.3,0);part(new THREE.CylinderGeometry(.10,.14,.7,8),'#d8aa80',s*.43,1,0);}
    part(new THREE.CylinderGeometry(.34,.37,.23,12),'#d1b686',0,1.96,0);
    part(new THREE.CylinderGeometry(.47,.47,.055,12),'#d1b686',0,1.86,0);
    if(kind==='woodcutter') {ball('#674333',0,1.5,.19,.23,.18,.13);const arm=new THREE.Group();arm.position.set(.55,1.1,.05);g.add(arm);const handle=part(new THREE.CylinderGeometry(.045,.045,.9,7),'#80532f',0,0,0);const blade=part(new THREE.BoxGeometry(.38,.25,.10),'#aeb9ba',.15,.35,0);arm.add(handle,blade);g.userData.arm=arm;}
  } else if(kind==='crab') {
    ball('#cb6c40',0,.34,0,.55,.25,.36);
    for(const s of [-1,1]){for(let i=0;i<3;i++){const leg=part(new THREE.CylinderGeometry(.035,.05,.6,6),'#d0874e',s*.55,.17,(i-1)*.22);leg.rotation.z=s*1.1;}ball('#e58b50',s*.64,.5,.34,.19,.22,.17);const claw=part(new THREE.ConeGeometry(.10,.28,6),'#e58b50',s*.7,.67,.34);claw.rotation.z=s*.4;part(new THREE.CylinderGeometry(.025,.025,.22,6),'#bf6a39',s*.18,.6,.17);ball('#24211d',s*.18,.75,.17,.06,.065,.06);}
  } else {
    const squirrel=kind==='squirrel',rabbit=kind==='rabbit',color=squirrel?'#aa6639':rabbit?'#d8cbb1':kind==='cat'?'#a89b81':'#b99564';
    ball(color,0,.53,0,.27,.43,.24);ball('#dfc59b',0,.54,.19,.16,.28,.08);ball(color,0,1.03,.10,.27,.26,.25);eyes(1.06,.32,.1);
    for(const s of [-1,1]){const ear=part(new THREE.ConeGeometry(.09,rabbit?.55:.20,8),color,s*.17,rabbit?1.48:1.30,.08);ear.rotation.z=s*.17;ball(color,s*.22,.10,.17,.15,.10,.19);}
    const tail=ball(color,0,squirrel?.8:.3,-.32,squirrel?.25:.14,squirrel?.55:.14,squirrel?.3:.14);tail.rotation.x=-.35;
  }
  return g;
}
function starMesh() {
  const shape=new THREE.Shape();for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?.20:.46;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?shape.lineTo(x,y):shape.moveTo(x,y);}shape.closePath();
  const star=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:1,steps:1}),new THREE.MeshStandardMaterial({color:'#ffd56b',emissive:'#8b5712',emissiveIntensity:.5,roughness:.4}));star.castShadow=true;return star;
}
function labelSprite(text) {
  const cv=document.createElement('canvas');cv.width=384;cv.height=96;const ctx=cv.getContext('2d');ctx.fillStyle='rgba(19,27,36,.88)';ctx.beginPath();ctx.roundRect(0,0,384,96,24);ctx.fill();ctx.fillStyle='#f8edcf';ctx.font='500 35px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,192,48,350);
  const texture=new THREE.CanvasTexture(cv);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true}));sprite.scale.set(3.6,.9,1);return sprite;
}
export class StoryNPCs {
  constructor(scene,meta,npcs,collected,onCollect) {
    this.group=new THREE.Group();this.group.visible=false;scene.add(this.group);this.meta=meta;this.time=0;this.onCollect=onCollect;
    this.entries=npcs.map(npc=>{const root=new THREE.Group(),model=npcModel(npc.kind),star=starMesh(),label=labelSprite(npc.name);root.position.set(npc.x,npc.y ?? meta.heightAt(npc.x,npc.z),npc.z);root.add(model,star,label);star.position.y=npc.kind==='person'||npc.kind==='woodcutter'?2.8:1.95;label.position.y=star.position.y+1;this.group.add(root);const done=collected.includes(npc.id);star.visible=!done;return {npc,root,model,star,label,done,baseStarY:star.position.y};});
    }
  update(dt,character) {
    this.time+=Math.min(dt,.05);if(character._enabled)this.group.visible=true;
    if(!character._enabled)return;
    for(const e of this.entries) {
      e.star.rotation.y=this.time*.9;e.star.position.y=e.baseStarY+Math.sin(this.time*2)*.12;
      if(e.model.userData.arm)e.model.userData.arm.rotation.z=Math.sin(this.time*1.6)*.28;
      const d=Math.hypot(character.pos.x-e.npc.x,character.pos.z-e.npc.z);
      e.label.visible=d<32;
      if(!e.done && d<2.7 && Math.abs(character.group.position.y-e.root.position.y)<2) {e.done=true;e.star.visible=false;this.onCollect(e.npc);}
    }
  }
  dispose(){this.group.removeFromParent();const disposed=new Set();this.group.traverse(o=>{for(const r of [o.geometry,o.material?.map,o.material])if(r&&!disposed.has(r)){disposed.add(r);r.dispose?.();}});}
}
