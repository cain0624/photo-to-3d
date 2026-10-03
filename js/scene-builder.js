import { buildLakeside } from './lakeside.js';
import { buildWorld } from './world-builder.js';

export class SceneBuilder {
  build(image, depth, opts = {}) {
    this.dispose();
    const world = opts.sceneId === 'default-111'
      ? buildLakeside(image, opts.grassImage)
      : buildWorld(image, opts.plan, opts.grassImage);
    this.group = world.group;
    this.disposables = world.resources;
    this.meta = world.meta;
    this.updateWorld = world.update;
    return world;
  }
  async buildMarble(world, renderer) {
    this.dispose();
    const { buildMarble } = await import('./marble-world.js');
    const result = await buildMarble(world,renderer);
    this.group=result.group;this.disposables=result.resources;this.meta=result.meta;this.isMarble=true;
    return result;
  }
  setFormation(value) { if(this.group && !this.isMarble) this.group.scale.y = Math.max(.02,value); }
  update(dt) { this.updateWorld?.(dt); }
  dispose() {
    this.updateWorld = null;
    const disposed = new Set();
    const release = x => { if(x && !disposed.has(x)){ disposed.add(x); x.dispose?.(); } };
    (this.disposables || []).forEach(release);
    this.group?.traverse(o => { release(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(release); });
    this.group?.removeFromParent();
    this.disposables = []; this.group = null;
  }
}
