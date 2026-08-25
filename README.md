# dsh-vision-bridge

DSH 插件：为纯文本模型提供视觉能力，复用 DSH 已添加的 Provider，也支持新增 OpenAI 兼容直连 Provider，**带设置页可视化配置**。

## 功能

- 提供 `vision_bridge_read_image` 工具：手动触发图片识别，返回结构化文本证据（OCR + 布局 + 语义）
- 粘贴图片时自动接管：上传图片并插入紧凑的一图一 ID 引用（例如 `「▧ 图片 #KdAy1D」`）
- **无厂商硬编码**：Provider 与模型列表实时读取 DSH registry
- **设置页「插件 → 视觉桥接」子菜单**：选择 DSH Provider，或新增自定义 Provider，保存即热生效
- **连通性测试**：一键向视觉 API 发送测试图，返回延迟与响应样本
- **不注册 wrapper provider**：选择 DSH Provider 时复用其 adapter、凭据和 attachment 通道

## 安装

```bash
# 方式一：DSH 插件 CLI（自动写入 bundles）
dsh plugin --profile web add github:alaxrpg/dsh-vision-bridge

# 方式二：手动安装
cd ~/.dsh/profiles/web
pnpm add github:alaxrpg/dsh-vision-bridge
```

方式二需在 `package.json` 的 `dsh.profile.bundles` 中追加 `"dsh-vision-bridge"`（或在
profile 的 `cordis.patch.yml` 中插入挂载行），**不要两种方式同时使用**。

## 配置

**推荐：GUI 设置页**。安装重启后打开 设置 → 插件 → 视觉桥接，即可：

- 从 DSH 当前已添加的 Provider 与模型中选择
- 新增本插件私有的 OpenAI 兼容直连 Provider
- 自定义 Provider 可直接填入 API Key（写入 settings.yaml，永不回显）
- 一键测试连通性
- 保存后**立即热生效**，无需重启 DSH

也可以直接编辑 `~/.dsh/settings.yaml` 的 `vision-bridge` 段：

```yaml
vision-bridge:
  enabled: true
  providerMode: dsh
  provider: your-dsh-provider-id
  model: your-vision-model-id
  timeout: 90
```

外部编辑 settings.yaml 同样会被监听并热生效。

### DSH 已添加 Provider

`providerMode: dsh` 时，设置页调用 `ctx.llm.listProviders()` 和 `ctx.llm.listModels()` 动态生成选项；
图片经 DSH attachment store 保存后交给选中 Provider 的 adapter。插件不读取该 Provider 的 Base URL 或密钥。

### 自定义 Provider

```yaml
vision-bridge:
  providerMode: custom
  provider: my-vision-provider
  baseUrl: https://your-api.com/v1
  model: your-vision-model
  apiKeyEnv: YOUR_API_KEY_ENV
```

自定义 Provider 只属于本插件的 OpenAI 兼容直连配置，不会注册到 DSH 全局 Provider 或模型列表。

### API Key 优先级

以下规则只适用于 `providerMode: custom`；DSH Provider 的凭据始终由其 adapter 管理：

1. `vision-bridge.apiKey`（settings.yaml 直填，或 GUI 输入框）
2. `vision-bridge.apiKeyEnv` → **DSH 凭据服务**（`ctx.credentials.resolve`，与模型配置/凭据页
   同一渠道）：按 进程环境 → `~/.dsh/.credentials.yaml` → `.env` 分层解析。

GET `/vision-bridge/config` 永远只返回 `keySource` / `keyResolved` 布尔状态，不回显密钥。

## 使用

安装并配置后，插件提供：

1. `vision_bridge_read_image` 工具（模型可主动调用识别图片）
2. 粘贴图片时自动上传并插入一图一 ID 短引用，模型据此调用视觉工具

也可以手动调用工具：

```
使用 vision_bridge_read_image 工具识别图片：/path/to/image.png
```

## 输出格式

插件返回结构化 JSON 证据：

```json
{
  "summary": "图片整体描述",
  "ocr": {
    "full_text": "完整 OCR 文本",
    "lines": [{"text": "行文本", "language": "zh"}]
  },
  "layout": {
    "regions": [{"type": "heading", "reading_order": 1, "text": "..."}]
  },
  "semantics": {
    "scene": "场景描述",
    "entities": [{"name": "实体名", "type": "类型"}]
  },
  "uncertainty": ["不确定项"]
}
```

## 技术要点

- **配置通道**：宿主 settings 服务（`@deepseek-ai/dsh-settings`），命名空间 `vision-bridge`
  （匹配宿主 `/^[a-z][a-z0-9-]*$/` 约定）；服务不可用时退化为 settings.yaml 直读（只读）
- **凭据通道**：API key 经宿主 credentials 服务（`@deepseek-ai/dsh-credentials`）解析，
  仅用于自定义直连 Provider；DSH Provider 复用自身 adapter 的凭据通道
- **DSH Provider 通道**：`ctx.llm.stream()` + attachment store，不复制或回显 DSH Provider 凭据
- **Web 路由**：`/vision-bridge/config`（GET 读 / POST 存，带 revision 乐观并发与同源防护）、
  `/vision-bridge/test`（连通性测试）、`/vision-bridge/paste`（粘贴上传）、`/vision-bridge/verdict`（是否接管粘贴）
- **客户端**：classic script 经 `__ModuleLoader__` 加载，`settings.plugin.item` 插槽注册可折叠插件配置子菜单；
  粘贴拦截在无插件 ctx 时也照常工作

## 兼容性

- DSH 0.1.1+
- Node.js 18+
- macOS / Linux

## License

MIT
