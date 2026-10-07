# Photo to 3D · 照片的下一维

从照片墙走进可漫游的三维空间，把生成能力连接到完整体验。

**作品形态：可运行体验 / 上传需服务配置**

[在线体验](https://cain0624.github.io/photo-to-3d/) · [个人作品集](https://kunyu-builds.s291623933.chatgpt.site/projects/photo-to-3d.html)

> 项目案例依据当前公开代码、页面、README 与提交记录整理。已实现、历史验证记录和下一步计划分别标明；模拟数据不作为真实业务结果。

## 背景

照片记录了一个视角，但观看者无法进入画面。这个作品探索把照片入口、空间生成、人物漫游与再次访问连成一条体验链路。

目标不是仅展示一张深度图，而是让用户完成选照片、进入场景、探索与保存。默认湖岸场景和用户上传采用不同的实现路径。



## 问题



- 单张照片无法提供背面、尺度和完整几何；缺失区域需要生成补全，不能宣称精确扫描。
- 生成是付费异步任务。刷新、超时与资产链接过期可能导致任务丢失或重复付费。
- 视觉资产不等于碰撞网格；人物可能穿墙、悬空，或出生在不可行走区域。

## 思考



- 把专门建模的默认体验与模型生成路径明确分开，让首次体验不依赖模型配置，也不伪装上传成功。
- 使用统一坐标、尺度与地面偏移对齐视觉和碰撞资产，把可行走性作为空间体验的一部分。
- 保存任务编号与资产引用，而非把整个世界存档当作已实现的离线能力。

## 动作



- 实现照片墙、约三秒空间进入动画、人物移动、视角控制与 IndexedDB 场景存档。
- 接入 Marble World API 异步生成，Spark 显示 splats，GLB 提供碰撞查询；服务密钥留在后端。
- 实现任务落盘、刷新恢复和同一世界资产链接刷新；增加照片故事、NPC 与三星探索任务。

## 优化



- 已实现：恢复已保存生成任务，避免重复创建付费任务；资产缺失时明确报错。
- 已实现：可行走出生点检查、坡度和墙体约束；每个场景独立保存故事与收星进度。
- 下一步：用真实上传照片验证生成质量、碰撞误差和等待体验，并评估资产缓存成本。

## 结果

已有默认场景的可运行漫游体验，以及上传生成、任务恢复和存档的工程路径。仓库提供后端、Marble 模拟与浏览器测试，但不能把模拟测试等同于真实模型质量验证。

尚无公开用户规模、空间生成成功率或商业收益数据。

- 建议衡量：进入场景成功率、任务恢复成功率、可行走异常率、等待阶段退出率、再次打开存档成功率。
- 验收路径：打开默认湖岸 → 漫游 → 接近 NPC 收星 → 返回并重开；上传路径需配置后端和 API 额度。

## 实现证据与关联作品

| 内容 | 文件 |
| --- | --- |
| 任务生成与恢复 | [backend/marble.py](https://github.com/cain0624/photo-to-3d/blob/main/backend/marble.py) |
| 视觉与碰撞对齐 | [js/marble-world.js](https://github.com/cain0624/photo-to-3d/blob/main/js/marble-world.js) |
| 场景故事 | [js/story-npcs.js](https://github.com/cain0624/photo-to-3d/blob/main/js/story-npcs.js) |

- [古伞文化馆](https://github.com/cain0624/gusan)

---

<details>
<summary>技术使用与原有说明（展开查看；能力边界以以上案例为准）</summary>

# 照片转三维场景

网站：https://cain0624.github.io/photo-to-3d/

照片墙、上传、约三秒空间展开、三维漫游与浏览器本地存档。内置「111 · 夕照湖岸」由专门建模完成。通用上传支持 Marble World API：照片生成三维 Gaussian Splat 资产，Spark 负责显示，配套 GLB 碰撞网格用于人物落地与阻挡。也保留原来的视觉模型 JSON + 基础几何模式。单张照片不可见区域仍是生成式补全，不能保证精确扫描或无瑕疵还原。

## 本地运行和配置

1. 在项目目录将 `.env.example` 复制为 `.env.local`。
2. 在 [World Labs 开发者平台](https://platform.worldlabs.ai/) 获取 World API 密钥，在 `.env.local` 填写：

   ```env
   SCENE_PROVIDER=marble
   MARBLE_BASE_URL=https://api.worldlabs.ai/marble/v1
   MARBLE_MODEL=marble-1.1
   MARBLE_API_KEY=你的World_API密钥
   ```

   更大世界可选择 `marble-1.1-plus`。API 额度与 Marble 网页订阅额度分开。密钥只放本地后端，不提交仓库、不填前端服务地址。

   如需旧模式：设置 `SCENE_PROVIDER=vision`，填写 `SCENE_VISION_BASE_URL`、`SCENE_VISION_MODEL`、`SCENE_VISION_KEY`，服务须支持图片输入、Chat Completions 和 JSON object 输出。
3. 运行 `python3 backend/server.py`。
4. 打开 http://127.0.0.1:8766/ ，点击“转换服务”检查连接，再上传图片。

不填模型也可以打开网站和默认场景。上传会明确提示配置缺失，不再把启发式浮雕作为三维转换结果。旧上传记录首次进入时重新分析；成功后存入新描述，失败时保留原记录。照片与场景存档使用 IndexedDB，同一浏览器和网站来源内保存，不同步到其他设备。

照片经浏览器压缩发送给本地后端，再发送到配置的 Marble / 视觉模型。Marble 生成是付费异步任务，生成完成后才播放约 3 秒的进入动画；动画时间不是模型生成时间。前端显示等待时间，不伪造模型完成百分比。

任务编号与原图保存到 IndexedDB，本地后端在忽略的 `.marble-jobs/` 保存操作编号与世界结果。生成时刷新网页后，点击“生成任务已保存”卡片继续同一任务，无需重新付费生成。恢复需要原来的后端及 `.marble-jobs/`；进入已保存世界会刷新同一世界的资产链接，不重新生成。存档目前保存照片和资产引用，未将整个三维资产缓存成离线包。

SPZ 与 collider GLB 按同一尺度、地面偏移和 OpenCV → Three.js 变换对齐。人物从原点附近可站立地面出生，避免无地面区域、陡坡和墙体。碰撞网格是简化几何，水域或薄结构是否正确阻挡取决于 Marble 输出；光照已烘焙进 splats，角色使用独立近似照明。Marble 缺少视觉或碰撞资产时显示错误，不退回浮雕。

## 静态网站连接后端

GitHub Pages 只托管前端。使用“转换服务”设置后端完整地址；跨站线上服务应使用 HTTPS，并配置 `SCENE_ALLOWED_ORIGINS`（默认允许当前本地站点和 `https://cain0624.github.io`）。本地后端仅绑定 `127.0.0.1`，适合开发；需要公网部署时另行配置 HTTPS、认证和限流。浏览器可能限制线上网页访问本地 HTTP 地址，因此本地开发请直接使用 8766 的网站。

不提供自动扩图假效果：竖图转换保留原照片，照片以保持比例的 cover 方式全屏展示；三维地形在照片之外延伸。Marble 会以普通照片（`is_pano=false`）先生成全景再生成世界，可补全照片外区域；不把竖图拉伸或镜像拼接。旧视觉 JSON 模式的真实扩图与复杂独立资产仍未实现。Marble 的 splat 视觉资产不能直接当作每棵树、每栋房屋可独立编辑的游戏网格。

## 实现

- `backend/scene_prompt.txt`：来自 photo-to-3d-world skill 的可执行分析要求和场景 JSON 合约。
- `backend/marble.py`：World API 图片生成、异步查询、任务落盘与资产链接刷新。
- `js/marble-world.js`：Spark splats 渲染、GLB 地面/墙体查询、可行走出生点。
- `backend/server.py`：标准库本地静态服务与视觉模型代理，读取 `.env.local`，不向浏览器暴露密钥。
- `js/reconstruction.js`：前端请求、连接检查与错误处理。
- `js/world-builder.js`：按每张照片的场景描述生成三维几何、地形、天空、水体与碰撞。
- `js/scene-builder.js`：统一构建入口；默认专门场景保留，新照片走场景描述。

参考接口：https://developers.openai.com/api/reference/resources/chat （OpenAI compatible 的实际支持范围取决于服务商）。

## 验证

`python3 tests/test_backend.py` 验证模型请求合约、非法几何拒绝、未配置服务和私密文件不可访问。

先启动本地后端，再运行 `node tests/browser.cjs`。该测试使用显式模拟视觉响应，验证两种场景几何、上传失败后重试、坡度、碰撞、刷新恢复、默认场景和浏览器错误，不验证模型理解照片的准确率。Playwright 的路径可通过 `PLAYWRIGHT_PATH` 设置。

Three.js 经 jsDelivr 加载，浏览器需支持 WebGL。`main` 分支推送后由 GitHub Pages 自动发布前端。

### Marble 接入验证

`python3 tests/test_marble.py` 使用模拟 World API 验证请求格式、任务恢复、同一世界链接刷新及密钥不返回前端。

`node tests/marble-browser.cjs` 使用合成 Gaussian Splat、碰撞 GLB 和模拟 API，验证生成时刷新恢复、真实 Spark 渲染、地面/墙体/边界碰撞、存档重开不再生成，以及默认场景回归。尚未使用用户照片调用真实 Marble 生成，需配置密钥和 API 额度后验证。

官方文档：[World API 图片输入](https://docs.worldlabs.ai/api/world-generation-examples)、[模型名称](https://docs.worldlabs.ai/api/models)、[尺度与坐标](https://docs.worldlabs.ai/api/rendering-spz)。

## 照片故事与三星任务

进入场景，点击“照片故事 / NPC”，用三句话或三行分别描述三位角色与位置，预览后创建 NPC。默认 111 场景包含树下的松鼠、木屋旁的砍树大叔和湖边的螃蟹；靠近每位 NPC（约 2.7 米、地面高度接近）自动获得一颗星，同一位只计一次。右下角仅显示三颗星的收集进度，收集时轻微亮起；集齐后可在“照片故事 / NPC”里重新收集星星。

故事、NPC 位置与收星进度存入对应场景的 IndexedDB 记录；重新进入保留进度，各场景独立。创建新故事会重置该场景任务。原有存档第一次进入时会增加默认任务。

当前使用浏览器关键词解析，无需模型服务。支持松鼠、伐木人、螃蟹、兔、猫、狗，其他名称使用旅人造型；不是任意角色的 AI 建模。默认场景有明确树、房屋、岸边锚点；场景描述模式按已有地物定位并寻找可行走位置。Marble splats 没有独立地物语义时，NPC 放在可到达的出生点周边，预览会标注。人物与 NPC 共用地形高度；非默认场景使用已有可行走查询排除墙体、水面与陡坡。

运行 `node tests/story-npcs.cjs` 验证默认三位 NPC、贴地、收集距离、重复收星防止、存档恢复、故事编辑、输入隔离、其他场景独立任务、可行走位置和手机故事面板。

</details>
