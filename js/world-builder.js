import * as THREE from 'three';

export function insidePolygon(x,z,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [ax,az]=points[i],[bx,bz]=points[j];
    if((az>z)!==(bz>z) && x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
  }
  return inside;
}
export function terrainHeight(heights,x,z) {
  const u=THREE.MathUtils.clamp((x+200)/50,0,8),v=THREE.MathUtils.clamp((z+200)/50,0,8);
  const ix=Math.min(7,Math.floor(u)),iz=Math.min(7,Math.floor(v));
  const tx=THREE.MathUtils.smoothstep(u-ix,0,1),tz=THREE.MathUtils.smoothstep(v-iz,0,1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(heights[iz][ix],heights[iz][ix+1],tx),THREE.MathUtils.lerp(heights[iz+1][ix],heights[iz+1][ix+1],tx),tz);
}
export function buildWorld(image,plan,grassImage) {
  const group=new THREE.Group(),resources=[],waterTimes=[];
  const keep=x=>(resources.push(x),x);
  const mat=(color,opts={})=>keep(new THREE.MeshStandardMaterial({color,roughness:.95,...opts}));
  const add=(geo,material,x=0,y=0,z=0)=>{
    const mesh=new THREE.Mesh(keep(geo),material);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);return mesh;
  };
  const heightAt=(x,z)=>terrainHeight(plan.terrain.heights,x,z);
  const terrainGeo=new THREE.PlaneGeometry(800,800,200,200);terrainGeo.rotateX(-Math.PI/2);
  const pos=terrainGeo.attributes.position;
  for(let i=0;i<pos.count;i++)pos.setY(i,heightAt(pos.getX(i),pos.getZ(i)));
  terrainGeo.computeVertexNormals();
  let texture=null;
  if(plan.terrain.surface==='grass'&&grassImage){texture=keep(new THREE.Texture(grassImage));texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.MirroredRepeatWrapping;texture.repeat.set(120,120);texture.needsUpdate=true;texture.anisotropy=8;}
  const terrainMat=mat(plan.terrain.color,{map:texture,bumpMap:texture,bumpScale:.07});
  terrainMat.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 terrainWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nterrainWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 terrainWorld;').replace('#include <map_fragment>',`#include <map_fragment>
      float variation=.88+.12*sin(terrainWorld.x*.09)*sin(terrainWorld.z*.12);
      diffuseColor.rgb*=variation;`);
  };
  add(terrainGeo,terrainMat);
  const collisionObjects=[];
  for(const o of plan.objects) {
    const object=new THREE.Group();object.position.set(o.x,heightAt(o.x,o.z),o.z);object.rotation.y=o.rotation;group.add(object);
    const part=(geo,m,y)=>{const mesh=new THREE.Mesh(keep(geo),m);mesh.position.y=y;mesh.castShadow=mesh.receiveShadow=true;object.add(mesh);return mesh;};
    if(o.kind==='tree') {
      part(new THREE.CylinderGeometry(o.width*.055,o.width*.10,o.height*.52,7),mat('#574936'),o.height*.26);
      const foliage=mat(o.color);
      for(let i=0;i<3;i++)part(new THREE.ConeGeometry(o.width*(.50-i*.11),o.height*(.53-i*.025),8),foliage,o.height*(.38+i*.20));
    } else if(o.kind==='rock') {
      const rock=part(new THREE.IcosahedronGeometry(1,1),mat(o.color,{flatShading:true}),o.height*.45);rock.scale.set(o.width*.5,o.height*.55,o.depth*.5);
    } else {
      const corner=[];
      for(const dx of [-o.width/2,o.width/2])for(const dz of [-o.depth/2,o.depth/2])corner.push(heightAt(o.x+dx*Math.cos(o.rotation)+dz*Math.sin(o.rotation),o.z-dx*Math.sin(o.rotation)+dz*Math.cos(o.rotation)));
      const base=Math.max(...corner);object.position.y=base;
      const foundationDepth=base-Math.min(...corner)+.25;
      part(new THREE.BoxGeometry(o.width,foundationDepth,o.depth),mat('#65625c'),-foundationDepth*.5);
      part(new THREE.BoxGeometry(o.width,o.height*.75,o.depth),mat(o.color),o.height*.375);
      if(o.kind==='building') {
        const roofHeight=o.height*.25,half=o.width*.5,slant=Math.hypot(half,roofHeight);
        const roofMat=mat(o.roofColor,{metalness:.12,roughness:.7});
        for(const side of [-1,1]){const p=part(new THREE.BoxGeometry(slant+.25,.12,o.depth+.5),roofMat,o.height*.75+roofHeight*.5);p.position.x=side*o.width*.25;p.rotation.z=-side*Math.atan2(roofHeight,half);}
        const gableShape=new THREE.Shape();gableShape.moveTo(-half,0);gableShape.lineTo(half,0);gableShape.lineTo(0,roofHeight);gableShape.closePath();
        const gableGeo=keep(new THREE.ShapeGeometry(gableShape)),gableMat=mat(o.color,{side:THREE.DoubleSide});
        for(const end of [-1,1]){const gable=new THREE.Mesh(gableGeo,gableMat);gable.position.set(0,o.height*.75,end*o.depth*.5);gable.castShadow=true;object.add(gable);}
        const door=part(new THREE.BoxGeometry(Math.min(1.1,o.width*.25),Math.min(2,o.height*.5),.08),mat('#302e2d'),Math.min(2,o.height*.5)*.5);door.position.z=o.depth*.5+.05;
        for(const side of [-1,1]){const window=part(new THREE.BoxGeometry(o.width*.15,o.height*.15,.08),mat('#75949f',{metalness:.15,roughness:.3}),o.height*.45);window.position.set(side*o.width*.32,o.height*.45,o.depth*.5+.05);}
      }
      collisionObjects.push(o);
    }
  }
  const shapeGeo=polygon=>{
    const shape=new THREE.Shape();polygon.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const original=new THREE.ShapeGeometry(shape),flat=original.toNonIndexed();original.dispose();flat.rotateX(-Math.PI/2);
    const source=flat.attributes.position,vertices=[];
    const split=(a,b,c,depth)=>{
      if(depth<5 && Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>12){
        const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);
        split(a,ab,ca,depth+1);split(ab,b,bc,depth+1);split(ca,bc,c,depth+1);split(ab,bc,ca,depth+1);
      }else vertices.push(...a.toArray(),...b.toArray(),...c.toArray());
    };
    for(let i=0;i<source.count;i+=3)split(new THREE.Vector3().fromBufferAttribute(source,i),new THREE.Vector3().fromBufferAttribute(source,i+1),new THREE.Vector3().fromBufferAttribute(source,i+2),0);
    flat.dispose();const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();return geo;
  };
  for(const path of plan.paths) {
    const geo=shapeGeo(path.polygon),p=geo.attributes.position;
    for(let i=0;i<p.count;i++)p.setY(i,heightAt(p.getX(i),p.getZ(i))+.08);
    geo.computeVertexNormals();add(geo,mat(path.color,{side:THREE.DoubleSide})).castShadow=false;
  }
  const light=new THREE.Vector3(...plan.lighting.sunDirection).normalize();
  for(const water of plan.waters) {
    const points=Array.from({length:24},(_,i)=>new THREE.Vector2(...(water.polygon[i]||water.polygon[0])));
    const uniforms={time:{value:0},base:{value:new THREE.Color(water.color)},gold:{value:new THREE.Color(water.reflectionColor)},sun:{value:light},points:{value:points},count:{value:water.polygon.length},fogColor:{value:new THREE.Color()},fogNear:{value:0},fogFar:{value:1}};
    waterTimes.push(uniforms.time);
    const material=keep(new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,
      vertexShader:`uniform float time; varying vec3 world; varying vec3 eye;
        #include <fog_pars_vertex>
        void main(){vec4 p=modelMatrix*vec4(position,1.);p.y+=.035*sin(p.x*.3+time)+.025*sin(p.z*.4-time*.7);world=p.xyz;eye=cameraPosition-world;vec4 mvPosition=viewMatrix*p;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader:`uniform float time;uniform vec3 base,gold,sun;uniform vec2 points[24];uniform int count;varying vec3 world,eye;
        #include <fog_pars_fragment>
        void main(){float edge=10000.;for(int i=0;i<24;i++){if(i>=count)break;vec2 a=points[i],b=points[i==count-1?0:i+1],p=world.xz;vec2 v=b-a;float t=clamp(dot(p-a,v)/max(dot(v,v),.001),0.,1.);edge=min(edge,length(p-a-t*v));}
        float w=sin(world.x*.72+world.z*.35+time)*sin(world.z*1.13-time*.8);
        vec3 n=normalize(vec3(.08*cos(world.x+time),1.,.09*sin(world.z*1.3-time)));
        float glint=pow(max(dot(reflect(-sun,n),normalize(eye)),0.),32.);
        float path=exp(-abs(world.x-world.z*sun.x/max(abs(sun.z),.2))*.018);
        vec3 c=mix(base,gold,path*(.25+.30*max(w,0.)))+gold*glint*.4;
        gl_FragColor=vec4(c*(.94+w*.06),smoothstep(0.,2.2,edge));
        #include <fog_fragment>
        #include <colorspace_fragment>
        }`}));
    const mesh=add(shapeGeo(water.polygon),material,0,water.level,0);mesh.castShadow=false;
  }
  // Only the sky crop is projected; world geometry is never painted onto the dome.
  const skyCanvas=document.createElement('canvas');skyCanvas.width=1024;skyCanvas.height=512;
  const ctx=skyCanvas.getContext('2d');
  if(plan.sky.horizon>0)ctx.drawImage(image,0,0,image.width,image.height*plan.sky.horizon,0,0,1024,512);
  else{ctx.fillStyle=plan.sky.topColor;ctx.fillRect(0,0,1024,512);}
  const skyTexture=keep(new THREE.CanvasTexture(skyCanvas));skyTexture.colorSpace=THREE.SRGBColorSpace;
  const skyUniforms={photo:{value:skyTexture},top:{value:new THREE.Color(plan.sky.topColor)},horizon:{value:new THREE.Color(plan.sky.horizonColor)},cloud:{value:new THREE.Color(plan.sky.cloudColor)},coverage:{value:plan.sky.cloudCoverage},hasPhoto:{value:plan.sky.horizon>0?1:0},time:{value:0}};
  const skyMaterial=keep(new THREE.ShaderMaterial({uniforms:skyUniforms,side:THREE.BackSide,depthWrite:false,
    vertexShader:'varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D photo;uniform vec3 top,horizon,cloud;uniform float coverage,hasPhoto,time;varying vec3 dir;
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){vec3 d=normalize(dir),p=d*vec3(9.,20.,9.)+vec3(time*.01,0,0);float f=0.,a=.5;for(int i=0;i<5;i++){f+=a*noise(p);p=p*2.03+vec3(4.1,2.3,7.7);a*=.5;}
      vec3 c=mix(horizon,top,smoothstep(0.,.8,d.y));float mask=smoothstep(.65-coverage*.3,.69-coverage*.3,f)*smoothstep(0.,.12,d.y);c=mix(c,cloud*(.7+f*.4),mask);
      vec2 uv=vec2(.5+atan(d.x,-d.z)/2.3,clamp(d.y*1.35,0.,1.));float blend=smoothstep(.02,.18,uv.x)*(1.-smoothstep(.82,.98,uv.x))*smoothstep(.03,.16,d.y)*(1.-smoothstep(.85,1.,uv.y))*smoothstep(0.,.5,-d.z)*hasPhoto;
      c=mix(c,texture2D(photo,clamp(uv,0.,1.)).rgb,blend);gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }`}));
  const sky=add(new THREE.SphereGeometry(2000,48,32),skyMaterial);sky.castShadow=sky.receiveShadow=false;
  const canWalk=(x,z)=>{
    if(plan.waters.some(w=>insidePolygon(x,z,w.polygon)))return false;
    for(const o of collisionObjects){const dx=x-o.x,dz=z-o.z,c=Math.cos(o.rotation),s=Math.sin(o.rotation);if(Math.abs(dx*c-dz*s)<o.width/2+.45&&Math.abs(dx*s+dz*c)<o.depth/2+.45)return false;}
    return Math.hypot(heightAt(x+.5,z)-heightAt(x-.5,z),heightAt(x,z+.5)-heightAt(x,z-.5))<1.3;
  };
  let spawn={...plan.spawn};
  if(!canWalk(spawn.x,spawn.z)){
    let found=false;
    for(let radius=2;radius<350&&!found;radius+=2)for(let i=0;i<32;i++){const x=spawn.x+radius*Math.cos(i*Math.PI/16),z=spawn.z+radius*Math.sin(i*Math.PI/16);if(Math.abs(x)<180&&Math.abs(z)<180&&canWalk(x,z)){spawn={...spawn,x,z};found=true;break;}}
    if(!found){resources.forEach(r=>r.dispose?.());throw new Error('没有找到可行走的出生点，请重新分析照片');}
  }
  if(plan.terrain.surface==='grass'){
    const geo=keep(new THREE.ConeGeometry(.045,.45,3)),m=mat(plan.terrain.color,{flatShading:true}),blades=new THREE.InstancedMesh(geo,m,10000),dummy=new THREE.Object3D();let n=0;
    for(let i=0;i<10000;i++){const hash=n=>{const v=Math.sin(n*127.1)*43758.5453;return v-Math.floor(v);};const x=spawn.x-90+hash(i+3)*180,z=spawn.z-90+hash(i+9)*180;if(!canWalk(x,z)||plan.paths.some(p=>insidePolygon(x,z,p.polygon)))continue;dummy.position.set(x,heightAt(x,z)+.2,z);dummy.scale.set(1,.65+hash(i+19),1);dummy.updateMatrix();blades.setMatrixAt(n++,dummy.matrix);}
    blades.count=n;blades.receiveShadow=true;group.add(blades);
  }
  return {group,resources,meta:{heightAt,groundY:heightAt(spawn.x,spawn.z),canWalk,spawn,bounds:{minX:-190,maxX:190,minZ:-190,maxZ:190}},fogColor:new THREE.Color(plan.sky.horizonColor),update(dt){skyUniforms.time.value+=dt;waterTimes.forEach(t=>t.value+=dt);}};
}
