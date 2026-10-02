import * as THREE from 'three';

const smooth = value => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

// The photo itself bends into depth before the live world is revealed.
export function startPhotoMorph(canvas, image, plan) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const camera = new THREE.PerspectiveCamera(25.36, aspect, .1, 100);
  camera.position.z = 20;
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  const imageAspect = image.width / image.height;
  if (imageAspect > aspect) {
    texture.repeat.x = aspect / imageAspect;
    texture.offset.x = (1 - texture.repeat.x) / 2;
  } else {
    texture.repeat.y = imageAspect / aspect;
    texture.offset.y = (1 - texture.repeat.y) / 2;
  }
  texture.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(9 * aspect, 9, 96, 54);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const photoMesh = new THREE.Mesh(geometry, material);
  scene.add(photoMesh);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const original = new Float32Array(position.array);
  const started = performance.now();
  let frame;
  const animate = now => {
    const progress = Math.min(1, (now - started) / 3000);
    const morph = smooth((progress - .12) / .72);
    photoMesh.scale.setScalar(1 + .27 * smooth(progress / .62));
    for (let i = 0; i < position.count; i++) {
      const u = uv.getX(i), v = uv.getY(i), j = i * 3;
      const horizon=plan ? 1-plan.sky.horizon : .36;
      const foreground = smooth((horizon - v) / Math.max(.15,horizon));
      const distance = smooth((v - horizon) / .25);
      const sky = smooth((v - .62) / .38);
      const hill = Math.exp(-Math.pow((v - .52) / .075, 2)) * (1 - Math.abs(u - .5) * .35);
      const depth = 5.4 * foreground - 1.8 * distance - 3.2 * sky + 1.1 * hill;
      const height = .8 * foreground + .22 * hill - .25 * sky;
      position.setXYZ(i, original[j], original[j + 1] + morph * height, original[j + 2] + morph * depth);
    }
    position.needsUpdate = true;
    renderer.render(scene, camera);
    if (progress < 1) frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  return () => {
    cancelAnimationFrame(frame);
    geometry.dispose(); material.dispose(); texture.dispose(); renderer.dispose();
  };
}
