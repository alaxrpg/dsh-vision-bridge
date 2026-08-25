# dsh-vision-bridge

DSH 插件：为纯文本模型提供视觉能力，支持任意 OpenAI 兼容多模态 API，**带设置页可视化配置**。

## 功能

- 自动为纯文本模型（DeepSeek、GLM、Qwen、MiMo 等）注册 wrapper provider
- 绕过 DSH 图片 admission 检查，使纯文本模型能接收图片
- 请求时自动将图片转换为结构化文本证据（OCR + 布局 + 语义）
- 支持任意 OpenAI 兼容多模态 API（SenseNova、OpenAI、Gemini、Ollama 等）
- 提供 `vision_bridge_read_image` 工具用于手动触发图片识别
- **设置页「视觉桥接」分节**：可视化编辑 provider / 模型 / API Key / 超时，保存即热生效
- **连通性测试**：一键向视觉 API 发送测试图，返回延迟与响应样本

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

**推荐：GUI 设置页**。安装重启后打开 设置 → 视觉桥接，即可：

- 切换 Provider 预设（下拉自动填充 baseUrl / model / key 环境变量）
- 直接填入 API Key（写入 settings.yaml，永不回显）
- 一键测试连通性
- 保存后**立即热生效**，无需重启 DSH

也可以直接编辑 `~/.dsh/settings.yaml` 的 `vision-bridge` 段：

```yaml
vision-bridge:
  enabled: true
  provider: sensennova  # sensennova | openai | gemini | ollama | custom
  model: sensenova-u1-fast
  apiKeyEnv: SENSENNOVA_API_KEY  # 环境变量名（也可用 apiKey 字段直填）
  timeout: 90
```

外部编辑 settings.yaml 同样会被监听并热生效。

### Provider 预设

| Provider | baseUrl | 默认 model | API Key 环境变量 |
|----------|---------|------------|-----------------|
| sensennova | https://token.sensenova.cn/v1 | sensenova-u1-fast | SENSENNOVA_API_KEY |
| openai | https://api.openai.com/v1 | gpt-4o | OPENAI_API_KEY |
| gemini | https://generativelanguage.googleapis.com/v1beta/openai | gemini-2.0-flash | GEMINI_API_KEY |
| ollama | http://localhost:11434/v1 | llava | OLLAMA_API_KEY |

### 自定义 Provider

```yaml
vision-bridge:
  provider: custom
  baseUrl: https://your-api.com/v1
  model: your-vision-model
  apiKeyEnv: YOUR_API_KEY_ENV
```

### API Key 优先级

1. `vision-bridge.apiKey`（settings.yaml 直填，或 GUI 输入框）
2. `vision-bridge.apiKeyEnv` 指向的环境变量（预设已带默认名）

GET `/vision-bridge/config` 永远只返回 `keySource` / `keyResolved` 布尔状态，不回显密钥。

## 使用

安装并配置后，插件会自动：

1. 为纯文本模型注册视觉能力（模型列表出现 `(vision bridge)` 后缀条目）
2. 粘贴图片时自动识别并转换为文本证据
3. 模型可以看到图片内容并进行分析

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
- **Web 路由**：`/vision-bridge/config`（GET 读 / POST 存，带 revision 乐观并发与同源防护）、
  `/vision-bridge/test`（连通性测试）、`/vision-bridge/paste`（粘贴上传）、`/vision-bridge/verdict`（是否接管粘贴）
- **客户端**：classic script 经 `__ModuleLoader__` 加载，`settings.section` 插槽注册设置分节；
  粘贴拦截在无插件 ctx 时也照常工作

## 兼容性

- DSH 0.1.1+
- Node.js 18+
- macOS / Linux

## License

MIT
