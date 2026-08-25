# dsh-vision-bridge

DSH 插件：为纯文本模型提供视觉能力，支持任意 OpenAI 兼容多模态 API。

## 功能

- 自动为纯文本模型（DeepSeek、GLM、Qwen、MiMo 等）注册 wrapper provider
- 绕过 DSH 图片 admission 检查，使纯文本模型能接收图片
- 请求时自动将图片转换为结构化文本证据（OCR + 布局 + 语义）
- 支持任意 OpenAI 兼容多模态 API（SenseNova、OpenAI、Gemini、Ollama 等）
- 提供 `vision_bridge_read_image` 工具用于手动触发图片识别

## 安装

```bash
# 在 DSH web profile 中安装
cd ~/.dsh/profiles/web
pnpm add dsh-vision-bridge
```

然后在 `package.json` 的 `dsh.profile.bundles` 中添加 `"dsh-vision-bridge"`。

## 配置

在 `~/.dsh/settings.yaml` 中添加 `visionBridge` 配置：

```yaml
visionBridge:
  enabled: true
  provider: sensennova  # sensennova | openai | gemini | ollama | custom
  model: sensenova-u1-fast
  apiKeyEnv: SENSENNOVA_API_KEY  # 环境变量名
  timeout: 90
```

### Provider 预设

| Provider | baseUrl | 默认 model | API Key 环境变量 |
|----------|---------|------------|-----------------|
| sensennova | https://token.sensenova.cn/v1 | sensenova-u1-fast | SENSENNOVA_API_KEY |
| openai | https://api.openai.com/v1 | gpt-4o | OPENAI_API_KEY |
| gemini | https://generativelanguage.googleapis.com/v1beta/openai | gemini-2.0-flash | GEMINI_API_KEY |
| ollama | http://localhost:11434/v1 | llava | OLLAMA_API_KEY |

### 自定义 Provider

```yaml
visionBridge:
  provider: custom
  baseUrl: https://your-api.com/v1
  model: your-vision-model
  apiKeyEnv: YOUR_API_KEY_ENV
```

## 使用

安装并配置后，插件会自动：

1. 为纯文本模型注册视觉能力
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

## 兼容性

- DSH 0.1.1+
- Node.js 18+
- macOS / Linux

## License

MIT
