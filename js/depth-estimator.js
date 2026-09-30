// depth-estimator.js — 从 2D 图像生成深度图（无需 ML，多线索启发式融合）
// 输出: { data: Float32Array(w*h) 0=远 1=近, width, height }
// 融合四条线索: 垂直位置、局部锐度(高频能量)、暗度(近暗远亮的照片)、中心聚焦

// ---------- 基础工具 ----------

function toGray(data, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

// 可分离盒式模糊（多次近似高斯），原地修改或返回新数组
function boxBlur(src, w, h, radius, dst) {
  if (radius < 1) return dst ? dst.set(src) : src.slice();
  const tmp = new Float32Array(w * h);
  const out = dst || new Float32Array(w * h);
  const win = radius * 2 + 1;
  // 水平
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = src[row + Math.min(w - 1, x + radius + 1)] || 0;
      const sub = src[row + Math.max(0, x - radius)] || 0;
      sum += add - sub;
    }
  }
  // 垂直
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = tmp[Math.min(h - 1, y + radius + 1) * w + x] || 0;
      const sub = tmp[Math.max(0, y - radius) * w + x] || 0;
      sum += add - sub;
    }
  }
  return out;
}

// 归一化到 0..1
function normalize(arr) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  const range = (max - min) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - min) / range;
  return arr;
}

// ---------- 主估计函数 ----------

export function estimateDepth(imageData) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;

  const gray = toGray(data, w, h);

  // 1) 局部锐度: 原图与模糊图之差的高频能量
  const blurred = boxBlur(gray, w, h, 6);
  const highFreq = new Float32Array(n);
  for (let i = 0; i < n; i++) highFreq[i] = Math.abs(gray[i] - blurred[i]);
  const sharp = boxBlur(highFreq, w, h, 10); // 局部平均高频能量
  normalize(sharp);

  // 2) 暗度线索: 较暗区域更近（夜景/室内常见），用 1 - 归一化亮度
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = gray[i] / 255;
  const darkness = new Float32Array(n);
  for (let i = 0; i < n; i++) darkness[i] = 1 - lum[i];

  // 3) 垂直位置线索: 越靠下越近（地面前景）
  const vertical = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 顶 .. 1 底
    const row = y * w;
    for (let x = 0; x < w; x++) vertical[row + x] = v;
  }

  // 4) 中心聚焦线索: 边缘较远，中心较近（轻微）
  const focus = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const dy = (y / (h - 1) - 0.5) * 2;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const dx = (x / (w - 1) - 0.5) * 2;
      focus[row + x] = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
    }
  }

  // 加权融合
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    depth[i] =
      0.38 * vertical[i] +
      0.30 * sharp[i] +
      0.18 * darkness[i] +
      0.14 * focus[i];
  }
  normalize(depth);

  // 平滑去噪，保留主结构
  boxBlur(depth, w, h, 4, depth);
  normalize(depth);

  // 强化对比（让前景更突出）
  for (let i = 0; i < n; i++) {
    depth[i] = Math.pow(depth[i], 0.85);
  }
  normalize(depth);

  return { data: depth, width: w, height: h };
}

// 把深度图渲染成可视化灰度图（用于存档缩略/调试）
export function depthToDataURL(depth) {
  const { data, width: w, height: h } = depth;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(data[i] * 255);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
