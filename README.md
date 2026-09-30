# 照片转三维场景

线上地址：https://cain0624.github.io/photo-to-3d/

照片墙、上传照片、三维场景漫游与场景存档。内置「111 · 夕照湖岸」可漫游场景。

照片与场景存档保存在当前浏览器的 IndexedDB 中，换浏览器或设备不会自动同步。普通上传照片采用本地深度估计，内置湖岸场景使用专门的三维地形、房屋和树木模型。

使用 Three.js，浏览器需支持 WebGL，并能访问 jsDelivr。

本地运行：`python3 serve.py`。

GitHub Pages 从 `main` 分支根目录发布；推送代码后自动更新。
