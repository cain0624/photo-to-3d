import * as THREE from 'three';

// A walkable 3D interpretation of the lakeside in 111.jpg.
export function buildLakeside(image, grassImage) {
  const group = new THREE.Group();
  const resources = [];
  const keep = object => { resources.push(object); return object; };
  const material = (color, options={}) => keep(new THREE.MeshStandardMaterial({color,roughness:1,...options}));
  const add = (geometry, mat, x=0, y=0, z=0) => {
    const object=new THREE.Mesh(keep(geometry),mat);
    object.position.set(x,y,z);
    object.receiveShadow=true;
    object.castShadow=true;
    group.add(object);
    return object;
  };
  // Project one source sky toward the original viewpoint; feather it into a continuous sky around the sides.
  const skyPhoto=keep(new THREE.Texture(image));
  skyPhoto.colorSpace=THREE.SRGBColorSpace;
  skyPhoto.needsUpdate=true;
  const skyUniforms={uTime:{value:0},uPhoto:{value:skyPhoto}};
  const skyMaterial=keep(new THREE.ShaderMaterial({
    uniforms:skyUniforms,side:THREE.BackSide,depthWrite:false,fog:false,
    vertexShader:`varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float uTime; uniform sampler2D uPhoto; varying vec3 vDirection;
      float hash3(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
      float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
      float fbm(vec3 p){float v=0.0,a=.5;for(int i=0;i<5;i++){v+=a*noise3(p);p=p*2.03+vec3(4.2,1.7,3.1);a*=.5;}return v;}
      void main(){vec3 d=normalize(vDirection);
        vec3 sun=normalize(vec3(.02,.12,-1.0));
        float sunFacing=max(dot(d,sun),0.0);
        float glow=pow(sunFacing,8.0);
        vec3 base=mix(vec3(.34,.38,.42),vec3(.17,.27,.37),smoothstep(-.06,.72,d.y));
        vec3 p=d*vec3(7.0,16.0,7.0)+vec3(uTime*.012,0.0,0.0);
        vec3 warp=vec3(fbm(p*.48),fbm(p*.48+vec3(9.7,2.1,3.4)),fbm(p*.48+vec3(4.1,8.3,5.6)));
        float shape=fbm(p+(warp-.5)*1.9);
        float detail=fbm(p*2.6+warp*.7);
        float density=shape*.68+detail*.32;
        float cloud=smoothstep(.50,.54,density);
        cloud*=smoothstep(-.04,.13,d.y);
        float litEdge=(smoothstep(.48,.53,density)-smoothstep(.56,.62,density))*cloud;
        vec3 cloudColour=mix(vec3(.18,.21,.25),vec3(.40,.35,.31),clamp(glow*.75+(1.0-d.y)*.16,0.0,1.0));
        cloudColour*=.92+.16*detail;
        vec3 colour=mix(base,cloudColour,cloud);
        colour+=vec3(.95,.47,.075)*litEdge*(.08+pow(sunFacing,3.0)*1.05);
        colour+=vec3(1.0,.52,.12)*pow(sunFacing,110.0)*.55;
        colour+=vec3(.66,.34,.12)*pow(sunFacing,15.0)*.10;
        float yaw=atan(d.x,-d.z);
        vec2 photoUv=vec2(.5+yaw/2.25,.46+d.y*.78);
        float photoBlend=smoothstep(.02,.18,photoUv.x)*(1.0-smoothstep(.82,.98,photoUv.x));
        photoBlend*=smoothstep(.44,.52,photoUv.y)*(1.0-smoothstep(.91,1.0,photoUv.y));
        photoBlend*=smoothstep(.05,.55,-d.z);
        colour=mix(colour,texture2D(uPhoto,clamp(photoUv,0.0,1.0)).rgb,photoBlend);
        colour=mix(colour,vec3(.30,.31,.30),1.0-smoothstep(-.12,.045,d.y));
        gl_FragColor=vec4(colour,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`
  }));
  const sky=add(new THREE.SphereGeometry(3000,64,32),skyMaterial);
  sky.castShadow=sky.receiveShadow=false;

  // World-space colour noise has no repeating tile or stretched photo pixels.
  const grassTexture=grassImage ? keep(new THREE.Texture(grassImage)) : null;
  if(grassTexture){
    grassTexture.colorSpace=THREE.SRGBColorSpace;
    grassTexture.wrapS=grassTexture.wrapT=THREE.MirroredRepeatWrapping;
    grassTexture.repeat.set(228,140);grassTexture.anisotropy=8;grassTexture.needsUpdate=true;
  }
  const grass=material(0xa4b29b,{map:grassTexture,bumpMap:grassTexture,bumpScale:.08,side:THREE.DoubleSide});
  grass.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGrassWorld;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGrassWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vGrassWorld;
      float grassHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float grassNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(grassHash(i),grassHash(i+vec2(1.,0.)),f.x),
                   mix(grassHash(i+vec2(0.,1.)),grassHash(i+vec2(1.,1.)),f.x),f.y);}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float broad=grassNoise(vGrassWorld.xz*.075);
      float detail=grassNoise(vGrassWorld.xz*.65);
      float speck=grassHash(floor(vGrassWorld.xz*6.0));
      vec3 grassDark=vec3(.62,.69,.53),grassBright=vec3(1.03,1.08,.94);
      vec3 meadow=diffuseColor.rgb*mix(grassDark,grassBright,clamp(broad*.72+detail*.23+speck*.05,0.,1.));
      float shoreNoise=grassNoise(vGrassWorld.xz*.16);
      float grassWeight=smoothstep(-3.,10.,vGrassWorld.z+(shoreNoise-.5)*3.5);
      vec3 sand=mix(vec3(.31,.24,.15),vec3(.48,.38,.24),grassNoise(vGrassWorld.xz*1.7));
      diffuseColor.rgb=mix(sand,meadow,grassWeight);`);
  };
  const grassDark=material(0x405b39), grassLight=material(0x73895a);
  const soil=material(0x6c6448), trunk=material(0x3d3d30);
  const waterUniforms={uTime:{value:0},fogColor:{value:new THREE.Color()},fogNear:{value:0},fogFar:{value:1}};
  const water=keep(new THREE.ShaderMaterial({
    uniforms:waterUniforms,side:THREE.DoubleSide,fog:true,transparent:true,depthWrite:false,
    vertexShader:`uniform float uTime; varying vec3 vWaterWorld; varying vec3 vEye;
      #include <fog_pars_vertex>
      void main(){vec3 p=position;
        p.y+=.14*sin(p.x*.045+uTime*.48)+.10*sin(p.z*.065-uTime*.34)+.055*sin((p.x+p.z)*.12+uTime*.62);
        vec4 world=modelMatrix*vec4(p,1.0);vWaterWorld=world.xyz;vEye=cameraPosition-world.xyz;
        vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`uniform float uTime; varying vec3 vWaterWorld; varying vec3 vEye;
      #include <fog_pars_fragment>
      void main(){float x=vWaterWorld.x,z=vWaterWorld.z;
        float w1=sin(x*.78+z*.16+uTime*1.8)*sin(z*.56-uTime*1.3);
        float w2=sin((x+z)*1.62-uTime*2.2);
        float dx=.11*cos(x*.78+z*.16+uTime*1.8)+.07*cos((x+z)*1.62-uTime*2.2);
        float dz=.10*cos(z*.56-uTime*1.3)+.07*cos((x+z)*1.62-uTime*2.2);
        vec3 n=normalize(vec3(-dx,1.0,-dz));
        vec3 eye=normalize(vEye);vec3 light=normalize(vec3(-.10,.55,-.83));
        float sparkle=pow(max(dot(reflect(-light,n),eye),0.0),86.0);
        float fresnel=pow(1.0-max(dot(n,eye),0.0),2.0);
        vec3 lake=mix(vec3(.29,.28,.27),vec3(.46,.37,.28),clamp(.5+w1*.17+w2*.08,0.0,1.0));
        float sunPath=exp(-abs(x+7.0)*.023)*(.73+.27*max(w1,0.0));
        lake=mix(lake,vec3(.99,.39,.035),sunPath*.95);
        lake+=vec3(.90,.62,.27)*sparkle*.27+vec3(.035,.035,.04)*fresnel;
        float distanceFade=1.0-smoothstep(-270.0,-75.0,z);
        lake=mix(lake,vec3(.39,.36,.32),distanceFade*.68);
        float shoreline=z+1.0*sin(x*.12)+.55*sin(x*.39)+.22*sin(x*.91);
        float shoreFade=1.0-smoothstep(-8.0,.5,shoreline);
        gl_FragColor=vec4(lake,shoreFade);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  const terrain=(x,z)=>{
    const coast=Math.max(0,Math.min(1,(z+8)/11));
    const coastalHeight=-.18+.36*coast*coast*(3-2*coast);
    const rise=15*(1-Math.exp(-Math.max(0,z-3)/55));
    const undulation=(.65*Math.sin(x*.095)*Math.cos(z*.07)+.22*Math.sin(x*.25+z*.12)+.13*Math.sin(x*.56)*Math.sin(z*.47))*coast;
    return coastalHeight+rise+undulation;
  };
  // Subdivided ground follows the same height field used by the walking character.
  function ground(){
    const width=1700,depth=1060,nx=500,nz=350;
    const geometry=new THREE.PlaneGeometry(width,depth,nx,nz);geometry.rotateX(-Math.PI/2);
    const position=geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),z=position.getZ(i)+520;
      position.setY(i,terrain(x,z));position.setZ(i,z);
    }
    geometry.computeVertexNormals();add(geometry,grass);
  }
  ground();
  const lakeGeo=new THREE.PlaneGeometry(1800,800,150,100);lakeGeo.rotateX(-Math.PI/2);
  const lakePos=lakeGeo.attributes.position;
  for(let i=0;i<lakePos.count;i++){const x=lakePos.getX(i),z=lakePos.getZ(i)-400;lakePos.setZ(i,z);lakePos.setY(i,.025*Math.sin(x*.21+z*.17));}
  lakeGeo.computeVertexNormals();const lake=add(lakeGeo,water);lake.castShadow=false;

  // Layered, mottled ridges replace the single-colour mountain wall.
  const farMountain=keep(new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,fog:true}));
  const nearMountain=keep(new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,fog:true}));
  function mountain(z,base,peaks,mat,isFar){
    const vertices=[],colours=[],indices=[],n=640,rows=8,width=2200;
    const low=new THREE.Color(isFar?0x3a4148:0x283439);
    const high=new THREE.Color(isFar?0x656971:0x454d51);
    const height=x=>base+peaks.reduce((sum,p)=>sum+p[1]*Math.exp(-Math.pow((x-p[0])/p[2],2)),0)+2.1*Math.sin(x*.009)+.8*Math.sin(x*.025)+.3*Math.sin(x*.07);
    for(let row=0;row<=rows;row++)for(let i=0;i<=n;i++){
      const x=-width/2+i*width/n,t=row/rows,h=height(x);
      const relief=(.36*Math.sin(x*.17+row*2.1)+.18*Math.sin(x*.47-row*1.7))*Math.sin(t*Math.PI);
      vertices.push(x,-.7+(h+.7)*Math.sin(t*Math.PI/2)+relief,z-row*7);
      const shade=.80+.15*Math.sin(x*.11+row*3.2)*Math.sin(x*.045-row*1.4)+.12*Math.sin(x*.37+row*1.9);
      const colour=low.clone().lerp(high,t*.73).multiplyScalar(shade);
      colours.push(colour.r,colour.g,colour.b);
      if(row<rows&&i<n){const a=row*(n+1)+i;indices.push(a,a+1,a+n+1,a+1,a+n+2,a+n+1);}
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
    geo.setIndex(indices);geo.computeVertexNormals();
    const ridge=add(geo,mat);ridge.castShadow=false;
  }
  mountain(-132,5,[[-480,5,145],[-240,7,95],[-37,7,30],[13,9,44],[72,5,30],[260,7,110],[530,5,150]],farMountain,true);
  mountain(-92,4,[[-510,4,125],[-230,6,115],[-45,7,36],[17,10,38],[75,4,28],[270,6,130],[540,4,145]],nearMountain,false);

  // The right shore and left peninsula match the land masses in the source photo.
  const peninsula=add(new THREE.SphereGeometry(1,32,14),grassDark,-54,-.18,-42);peninsula.scale.set(56,1.8,8);
  const rightBank=add(new THREE.SphereGeometry(1,32,14),grassDark,70,-.25,-23);rightBank.scale.set(71,2.2,13);
  const foliage=[material(0x263d2b,{flatShading:true,roughness:1}),material(0x3d5b39,{flatShading:true,roughness:1}),material(0x61744b,{flatShading:true,roughness:1}),material(0x314e37,{flatShading:true,roughness:1})];
  function tree(x,z,size=1){
    const y=z>1?terrain(x,z):.25;
    const seed=Math.abs(Math.round(x*13+z*7));
    const lean=(seed%7-3)*.025*size;
    const stem=add(new THREE.CylinderGeometry(.085*size,.18*size,2.3*size,7),trunk,x,y+1.15*size,z);
    stem.rotation.z=lean;
    for(let i=0;i<3;i++){
      const crown=add(new THREE.ConeGeometry((.78-i*.15)*size,(1.5-i*.08)*size,8),foliage[(seed+i)%foliage.length],x+lean*(i+1),y+(1.55+i*.55)*size,z);
      crown.rotation.z=lean;
    }
  }
  for(let i=0;i<54;i++)tree(-108+i*3.3,-38+Math.sin(i*.52)*2,.5+(i%5)*.13);
  for(let i=0;i<54;i++)tree(21+(i*37%88),-17+(i*17%44),.7+(i%7)*.15);
  const farTrunkGeo=keep(new THREE.CylinderGeometry(.11,.18,1.6,6));
  const farCrownGeo=keep(new THREE.ConeGeometry(.95,2.25,7));
  const farTrunks=new THREE.InstancedMesh(farTrunkGeo,trunk,180);
  const farCrowns=new THREE.InstancedMesh(farCrownGeo,material(0xffffff,{flatShading:true,roughness:1}),180);
  const dummy=new THREE.Object3D();
  for(let i=0;i<180;i++){
    const x=-260+(i*79%520),z=22+(i*67%335),s=.6+(i%5)*.15,y=terrain(x,z);
    dummy.position.set(x,y+.8*s,z);dummy.scale.setScalar(s);dummy.updateMatrix();farTrunks.setMatrixAt(i,dummy.matrix);
    dummy.position.y=y+(1.8+(i%4)*.12)*s;
    dummy.scale.set(s*(.78+(i%5)*.14),s*(.75+(i%7)*.09),s*(.72+(i%3)*.16));
    dummy.rotation.y=i*2.4;dummy.updateMatrix();farCrowns.setMatrixAt(i,dummy.matrix);
    farCrowns.setColorAt(i,new THREE.Color([0x425e3a,0x638153,0x4d7048,0x839568][i%4]));
  }
  farTrunks.instanceMatrix.needsUpdate=farCrowns.instanceMatrix.needsUpdate=true;
  farTrunks.castShadow=farCrowns.castShadow=false;group.add(farTrunks,farCrowns);

  // Red timber siding, pale corner trim, dark metal gable roofs and doors.
  const timberCanvas=document.createElement('canvas');timberCanvas.width=256;timberCanvas.height=256;
  const timberCtx=timberCanvas.getContext('2d');timberCtx.fillStyle='#673d37';timberCtx.fillRect(0,0,256,256);
  for(let y=0;y<256;y+=22){timberCtx.fillStyle=y%44?'#74443a':'#5b342f';timberCtx.fillRect(0,y,256,18);timberCtx.fillStyle='#2e2525';timberCtx.fillRect(0,y+18,256,3);}
  const timberTexture=keep(new THREE.CanvasTexture(timberCanvas));timberTexture.colorSpace=THREE.SRGBColorSpace;timberTexture.wrapS=timberTexture.wrapT=THREE.RepeatWrapping;timberTexture.repeat.set(2,1);
  const wall=material(0xffffff,{map:timberTexture});
  const roof=material(0x38434a,{metalness:.28,roughness:.6});
  const trim=material(0xd3d2c7),door=material(0x312c2b),foundation=material(0x4b493b);
  function cabin(x,z,w,d){
    const corners=[terrain(x-w/2,z-d/2),terrain(x-w/2,z+d/2),terrain(x+w/2,z-d/2),terrain(x+w/2,z+d/2)];
    const y=Math.max(...corners)-.1;
    const foundationBottom=Math.min(...corners)-.3;
    add(new THREE.BoxGeometry(w+.12,y-foundationBottom+.1,d+.12),foundation,x,(y+foundationBottom)/2,z);
    add(new THREE.BoxGeometry(w,2.5,d),wall,x,y+1.25,z);
    const slope=Math.atan2(1.3,w/2),panelWidth=Math.hypot(w/2,1.3)+.45;
    for(const side of [-1,1]){
      const panel=add(new THREE.BoxGeometry(panelWidth,.13,d+.65),roof,x+side*w/4,y+2.5+.65,z);
      panel.rotation.z=-side*slope;
    }
    for(const side of [-1,1])for(const end of [-1,1])add(new THREE.BoxGeometry(.11,2.6,.11),trim,x+side*w/2,y+1.3,z+end*d/2);
    add(new THREE.BoxGeometry(1.05,1.75,.09),door,x,y+.88,z+d/2+.07);
    add(new THREE.BoxGeometry(1.28,.1,.12),trim,x,y+1.8,z+d/2+.1);
    add(new THREE.BoxGeometry(.72,.58,.09),material(0x7795a0,{metalness:.2,roughness:.25}),x-w*.32,y+1.4,z+d/2+.08);
  }
  cabin(-22,9,5.8,4.7);cabin(-13,8,6.3,5);cabin(14,7,5.2,4.5);cabin(24,10,4.7,4);

  // Individual crossed grass blades add real close-range parallax above the photographic soil.
  const bladePositions=[];
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5,dx=Math.cos(a),dz=Math.sin(a),px=-dz,pz=dx,w=.018;
    bladePositions.push(px*w,0,pz*w,-px*w,0,-pz*w,dx*.10,.34,dz*.10);
  }
  const bladeGeo=keep(new THREE.BufferGeometry());
  bladeGeo.setAttribute('position',new THREE.Float32BufferAttribute(bladePositions,3));bladeGeo.computeVertexNormals();
  const bladeMat=material(0xffffff,{side:THREE.DoubleSide,flatShading:true});
  const bladeCount=80000,blades=new THREE.InstancedMesh(bladeGeo,bladeMat,bladeCount);
  const rand=n=>{const v=Math.sin(n*127.1)*43758.5453;return v-Math.floor(v);};
  const cabinFootprints=[[-22,9,5.8,4.7],[-13,8,6.3,5],[14,7,5.2,4.5],[24,10,4.7,4]];
  for(let i=0;i<bladeCount;i++){
    const close=i<25000;
    let x=close?-110+rand(i+4)*220:-650+rand(i+4)*1300;
    let z=close?4+rand(i*3+8)*180:8+rand(i*3+8)*840;
    // Keep blades out of walls and the coastal fade so geometry cannot poke through.
    for(let attempt=0;attempt<5;attempt++){
      const blocked=z<10 || cabinFootprints.some(([cx,cz,w,d])=>Math.abs(x-cx)<w/2+.55&&Math.abs(z-cz)<d/2+.55);
      if(!blocked)break;
      x=close?-110+rand(i+attempt*37+4)*220:-650+rand(i+attempt*37+4)*1300;
      z=close?10+rand(i*3+attempt*53+8)*174:10+rand(i*3+attempt*53+8)*838;
    }
    const s=.7+rand(i*5+12)*.8;
    dummy.position.set(x,terrain(x,z)+.015,z);dummy.scale.setScalar(s);
    dummy.rotation.set(0,rand(i*7+20)*Math.PI*2,0);dummy.updateMatrix();blades.setMatrixAt(i,dummy.matrix);
    blades.setColorAt(i,new THREE.Color(0x315f20).lerp(new THREE.Color(0x789444),rand(i*11+2)));
  }
  blades.instanceMatrix.needsUpdate=true;blades.castShadow=false;blades.frustumCulled=false;group.add(blades);
  return {group,resources,update(dt){skyUniforms.uTime.value+=dt;waterUniforms.uTime.value+=dt;},meta:{groundY:terrain(0,45),heightAt:terrain,bounds:{minX:-520,maxX:520,minZ:4,maxZ:760}},fogColor:new THREE.Color(0x96968f)};
}
