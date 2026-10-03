import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

// Apply the same metric/ground/OpenCV transform to visuals and collision assets.
export function collisionMeta(collider) {
  collider.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(collider),meshes=[];
  collider.traverse(o=>{if(o.isMesh){const old=Array.isArray(o.material)?o.material:[o.material];old.forEach(m=>m.dispose());o.material=new THREE.ShadowMaterial({side:THREE.DoubleSide,opacity:.18,depthWrite:false});meshes.push(o);}});
  const ray=new THREE.Raycaster(),normal=new THREE.Vector3(),matrix=new THREE.Matrix3();
  function floor(x,z,reference=0){
    ray.set(new THREE.Vector3(x,Math.min(box.max.y+.1,reference+1.4),z),new THREE.Vector3(0,-1,0));
    ray.far=Math.max(3,reference-box.min.y+2);
    return ray.intersectObjects(meshes,false).find(hit=>{
      matrix.getNormalMatrix(hit.object.matrixWorld);normal.copy(hit.face.normal).applyMatrix3(matrix).normalize();
      return Math.abs(normal.y)>.65;
    });
  }
  let spawn;
  // Prefer origin, then search nearby grounded space; never invent a flat floor.
  for(let radius=0;radius<=40&&!spawn;radius+=1){
    for(let step=0;step<(radius?24:1);step++){
      const angle=step*Math.PI/12,x=Math.sin(angle)*radius,z=Math.cos(angle)*radius;
      if(x<box.min.x+.5||x>box.max.x-.5||z<box.min.z+.5||z>box.max.z-.5)continue;
      const hit=floor(x,z,0);
      if(hit&&Math.abs(hit.point.y)<4){spawn={x,z,y:hit.point.y,yaw:0,pitch:.35,distance:6};break;}
    }
  }
  if(!spawn)throw new Error('此世界没有可用的地面出生点，请在 Marble 中检查碰撞网格。');
  let last={...spawn};
  function canWalk(x,z){
    const hit=floor(x,z,last.y);
    if(!hit||Math.abs(hit.point.y-last.y)>.45)return false;
    const dx=x-last.x,dz=z-last.z,length=Math.hypot(dx,dz);
    if(length>0){
      ray.set(new THREE.Vector3(last.x,last.y+.8,last.z),new THREE.Vector3(dx,0,dz).normalize());ray.far=length+.35;
      if(ray.intersectObjects(meshes,false).length)return false;
    }
    last={x,z,y:hit.point.y};return true;
  }
  return {bounds:{minX:box.min.x+.5,maxX:box.max.x-.5,minZ:box.min.z+.5,maxZ:box.max.z-.5},spawn,
    heightAt:(x,z)=>floor(x,z,last.y)?.point.y??last.y,canWalk,resetGround:()=>{last={...spawn};}};
}
export async function buildMarble(world,renderer) {
  const group=new THREE.Group(),resources=[];
  const spark=new SparkRenderer({renderer});group.add(spark);resources.push(spark);
  const splat=new SplatMesh({url:world.splatUrl});resources.push(splat);
  try {
    await splat.initialized;
    const semantics=world.semantics||{},scale=semantics.metric_scale_factor??1,offset=semantics.ground_plane_offset??0;
    if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(offset))throw new Error('无效的世界尺度');
    splat.scale.setScalar(scale);splat.rotation.x=Math.PI;splat.position.y=offset;group.add(splat);
    const gltf=await new GLTFLoader().loadAsync(world.colliderUrl),collider=gltf.scene;
    collider.scale.setScalar(scale);collider.rotation.x=Math.PI;collider.position.y=offset;
    group.add(collider);
    const meta=collisionMeta(collider);
    collider.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
    return {group,resources,meta,fogColor:new THREE.Color('#b6c7d1')};
  } catch(error){resources.forEach(x=>x.dispose?.());throw error;}
}
