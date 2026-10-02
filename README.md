# 照片转三维场景

网站：https://cain0624.github.io/photo-to-3d/

照片墙、上传、约三秒空间展开、三维漫游与浏览器本地存档。内置「111 · 夕照湖岸」由专门建模完成。其他照片现在通过视觉模型生成场景描述，再构建连续地形、立体建筑、树、岩石、水域、光照及行走碰撞。它是视觉辅助的近似三维重建，不是精确扫描、完整生成式三维资产或复制示例。

## 本地运行和配置

1. 在项目目录将 `.env.example` 复制为 `.env.local`。
2. 填写 `SCENE_VISION_BASE_URL`、`SCENE_VISION_MODEL` 和 `SCENE_VISION_KEY`。服务须支持图片输入、Chat Completions 和 JSON object 输出；BASE_URL 应为包含 `/v1` 的接口根地址，不包含 `/chat/completions`。密钥只存后端，不提交仓库。
3. 运行 `python3 backend/server.py`。
4. 打开 http://127.0.0.1:8766/ ，点击“转换服务”检查连接，再上传图片。

不填模型也可以打开网站和默认场景。上传会明确提示配置缺失，不再把启发式浮雕作为三维转换结果。旧上传记录首次进入时重新分析；成功后存入新描述，失败时保留原记录。照片与场景存档使用 IndexedDB，同一浏览器和网站来源内保存，不同步到其他设备。

照片经浏览器压缩发送给本地后端，再发送到用户配置的视觉模型。未知背面、遮挡和尺度由模型近似推断。后端做数值、颜色、对象数量、轮廓与高度场验证，并限制请求体和并发。

## 静态网站连接后端

GitHub Pages 只托管前端。使用“转换服务”设置后端完整地址；跨站线上服务应使用 HTTPS，并配置 `SCENE_ALLOWED_ORIGINS`（默认允许当前本地站点和 `https://cain0624.github.io`）。本地后端仅绑定 `127.0.0.1`，适合开发；需要公网部署时另行配置 HTTPS、认证和限流。浏览器可能限制线上网页访问本地 HTTP 地址，因此本地开发请直接使用 8766 的网站。

不提供自动扩图假效果：竖图转换保留原照片，照片以保持比例的 cover 方式全屏展示；三维地形在照片之外延伸。真正横图扩图和逼真的独立生成资产尚未接入。复杂人物、雕塑、精细建筑与室内细节超出当前基础几何类型，需进一步接入资产生成或更专业重建服务。

## 实现

- `backend/scene_prompt.txt`：来自 photo-to-3d-world skill 的可执行分析要求和场景 JSON 合约。
- `backend/server.py`：标准库本地静态服务与视觉模型代理，读取 `.env.local`，不向浏览器暴露密钥。
- `js/reconstruction.js`：前端请求、连接检查与错误处理。
- `js/world-builder.js`：按每张照片的场景描述生成三维几何、地形、天空、水体与碰撞。
- `js/scene-builder.js`：统一构建入口；默认专门场景保留，新照片走场景描述。

参考接口：https://developers.openai.com/api/reference/resources/chat （OpenAI compatible 的实际支持范围取决于服务商）。

## 验证

`python3 tests/test_backend.py` 验证模型请求合约、非法几何拒绝、未配置服务和私密文件不可访问。

先启动本地后端，再运行 `node tests/browser.cjs`。该测试使用显式模拟视觉响应，验证两种场景几何、上传失败后重试、坡度、碰撞、刷新恢复、默认场景和浏览器错误，不验证模型理解照片的准确率。Playwright 的路径可通过 `PLAYWRIGHT_PATH` 设置。

Three.js 经 jsDelivr 加载，浏览器需支持 WebGL。`main` 分支推送后由 GitHub Pages 自动发布前端。
