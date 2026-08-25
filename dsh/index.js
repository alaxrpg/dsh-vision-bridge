// dsh-vision-bridge: 为 DSH 纯文本模型提供视觉能力的通用桥接插件
// 支持任意 OpenAI 兼容多模态 API（SenseNova、OpenAI、Gemini、Ollama 等）

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================================
// 配置
// ============================================================================

const DEFAULT_TIMEOUT_MS = 90_000
const SETTINGS_NAMESPACE = 'visionBridge'

// Provider 预设
const PROVIDER_PRESETS = {
  sensennova: {
    baseUrl: 'https://token.sensenova.cn/v1',
    model: 'sensenova-u1-fast',
    apiKeyEnv: 'SENSENNOVA_API_KEY',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llava',
    apiKeyEnv: 'OLLAMA_API_KEY',
  },
}

// 纯文本模型家族前缀（用于自动发现需要 wrapper 的模型）
const TEXT_ONLY_FAMILIES = ['deepseek', 'glm', 'qwen', 'mimo']

// 视觉模型名称模式（跳过 wrapper）
const VISION_ID_PATTERN = /(vl|ocr|janus|v\d|vision|multimodal|u1|u1\.5)/i

// ============================================================================
// 工具定义
// ============================================================================

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '图片整体描述' },
    ocr: {
      type: 'object',
      properties: {
        full_text: { type: 'string', description: '完整 OCR 文本' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              language: { type: 'string' },
            },
            required: ['text'],
          },
        },
      },
      required: ['full_text', 'lines'],
    },
    layout: {
      type: 'object',
      properties: {
        regions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              reading_order: { type: 'number' },
              text: { type: 'string' },
            },
            required: ['type', 'reading_order', 'text'],
          },
        },
      },
      required: ['regions'],
    },
    semantics: {
      type: 'object',
      properties: {
        scene: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['name', 'type'],
          },
        },
      },
      required: ['scene', 'entities'],
    },
    uncertainty: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'ocr', 'layout', 'semantics', 'uncertainty'],
}

// ============================================================================
// 图片处理
// ============================================================================

const HEIC_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis',
  'hevm', 'hevs', 'mif1', 'mif2', 'msf1',
])

function sniffMime(data) {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (data.length >= 6 && data.toString('ascii', 0, 6) === 'GIF87a') return 'image/gif'
  if (data.length >= 6 && data.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') {
    const brand = data.toString('ascii', 8, 12)
    if (HEIC_BRANDS.has(brand)) return 'image/heic'
  }
  return null
}

function guessMime(path) {
  if (path.toLowerCase().endsWith('.heic') || path.toLowerCase().endsWith('.heif')) return 'image/heic'
  if (path.toLowerCase().endsWith('.png')) return 'image/png'
  if (path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg')) return 'image/jpeg'
  if (path.toLowerCase().endsWith('.gif')) return 'image/gif'
  if (path.toLowerCase().endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

// ============================================================================
// 视觉 API 调用
// ============================================================================

async function callVisionApi(config, images, prompt, signal) {
  const { baseUrl, apiKey, model, timeout = DEFAULT_TIMEOUT_MS } = config

  const content = [{ type: 'text', text: prompt }]
  for (let i = 0; i < images.length; i++) {
    if (images.length > 1) {
      content.push({ type: 'text', text: `(第 ${i + 1} 张图片)` })
    }
    content.push({
      type: 'image_url',
      image_url: { url: images[i] },
    })
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
  })

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'dsh-vision-bridge/0.1.0',
    },
    body,
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Vision API error ${response.status}: ${text.slice(0, 500)}`)
  }

  const result = await response.json()
  const content_text = result.choices?.[0]?.message?.content
  if (!content_text) {
    throw new Error('Vision API returned empty response')
  }

  // 尝试解析结构化 JSON，失败则返回纯文本
  try {
    return JSON.parse(content_text)
  } catch {
    return {
      summary: content_text,
      ocr: { full_text: content_text, lines: [] },
      layout: { regions: [] },
      semantics: { scene: 'unknown', entities: [] },
      uncertainty: ['Response was not structured JSON'],
    }
  }
}

async function imageToDataUrl(ctx, attachment) {
  // 从附件读取图片并转为 data URL
  if (attachment.dataUrl) return attachment.dataUrl
  if (attachment.url) return attachment.url

  // 读取文件
  const { readFile } = await import('node:fs/promises')
  const data = await readFile(attachment.path)
  const mime = sniffMime(data) || guessMime(attachment.path)
  const base64 = data.toString('base64')
  return `data:${mime};base64},${base64}`
}

// ============================================================================
// 插件主逻辑
// ============================================================================

export const name = 'dsh-vision-bridge'
export const inject = ['tools', 'llm', 'webServer']

export function apply(ctx, config = {}) {
  // 读取配置
  const visionConfig = resolveConfig(ctx, config)
  if (!visionConfig) {
    console.error('[dsh-vision-bridge] 未配置 vision provider，插件未激活')
    return
  }

  const evidenceCache = new Map()
  const ownProviders = new Set()

  // 注册 wrapper provider
  if (typeof ctx.inject === 'function') {
    ctx.inject(['llm'], (scope) => {
      registerVisionProvider(scope, visionConfig, ownProviders, evidenceCache)
    })
  } else {
    registerVisionProvider(ctx, visionConfig, ownProviders, evidenceCache)
  }

  // 注册工具
  const readImageTool = {
    name: 'vision_bridge_read_image',
    description:
      'Read an image through the vision bridge. Use whenever a message references an image the current model cannot see: a local file path or an http(s) URL to a screenshot, photo, chart, diagram, or document scan. Returns structured evidence with OCR text, layout regions, and semantics.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute local file path or http(s) URL of the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional extra focus for the reading',
        },
      },
      required: ['path'],
    },
    output: {
      schema: VISION_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: visionConfig.timeout + 20_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (typeof args?.path !== 'string' || args.path.trim() === '') {
        throw new Error('vision_bridge_read_image needs a non-empty "path"')
      }

      const prompt = args.prompt || '请用中文详细描述这张图片的内容，包括文字、布局和语义信息'
      const images = [await resolveImagePath(ctx, args.path)]
      const result = await callVisionApi(visionConfig, images, prompt)
      return result
    },
  }

  try {
    ctx.tools.register(readImageTool)
  } catch (error) {
    console.error(`[dsh-vision-bridge] 工具注册失败: ${error}`)
  }

  // 注册 web 路由（粘贴上传和 verdict 判断）
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      registerPasteRoute(scope, visionConfig, ownProviders)
      registerVerdictRoute(scope, ownProviders)
    })
  }
}

// ============================================================================
// 配置解析
// ============================================================================

function resolveConfig(ctx, pluginConfig) {
  // 从 settings.yaml 读取 visionBridge 配置
  let settings = {}
  try {
    if (typeof ctx.settings === 'function') {
      settings = ctx.settings(SETTINGS_NAMESPACE) || {}
    }
  } catch {}

  // 合并配置：pluginConfig > settings > presets
  const providerName = pluginConfig.provider || settings.provider || 'sensennova'
  const preset = PROVIDER_PRESETS[providerName] || PROVIDER_PRESETS.sensennova

  const baseUrl = pluginConfig.baseUrl || settings.baseUrl || preset.baseUrl
  const model = pluginConfig.model || settings.model || preset.model
  const apiKeyEnv = pluginConfig.apiKeyEnv || settings.apiKeyEnv || preset.apiKeyEnv
  const timeout = pluginConfig.timeout || settings.timeout || DEFAULT_TIMEOUT_MS

  // 解析 API key
  let apiKey = pluginConfig.apiKey || settings.apiKey || ''
  if (!apiKey && apiKeyEnv) {
    apiKey = process.env[apiKeyEnv] || ''
  }

  if (!apiKey) {
    console.error(`[dsh-vision-bridge] 未找到 API key，请设置 ${apiKeyEnv} 环境变量`)
    return null
  }

  return { baseUrl, apiKey, model, timeout, provider: providerName }
}

async function resolveImagePath(ctx, path) {
  // 如果是 URL，直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  // 如果是 data URL，直接返回
  if (path.startsWith('data:')) {
    return path
  }

  // 本地文件，读取并转为 data URL
  const { readFile, stat } = await import('node:fs/promises')
  const { resolve } = await import('node:path')

  const filePath = resolve(path)
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) {
    throw new Error(`File not found: ${filePath}`)
  }

  const data = await readFile(filePath)
  const mime = sniffMime(data) || guessMime(filePath)
  const base64 = data.toString('base64')
  return `data:${mime};base64},${base64}`
}

// ============================================================================
// Wrapper Provider 注册
// ============================================================================

function registerVisionProvider(ctx, config, ownProviders, evidenceCache) {
  const llm = ctx.llm
  if (typeof llm?.registerAdapter !== 'function' || typeof llm?.stream !== 'function') {
    return
  }

  const providerId = 'vision-bridge'

  // 判断模型是否需要 wrapper
  const shouldWrap = (info) => {
    const id = String(info?.id ?? '').toLowerCase()
    // 已声明视觉能力的模型不需要 wrapper
    if (VISION_ID_PATTERN.test(id)) return false
    if (Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')) return false
    // 检查是否是纯文本模型家族
    return TEXT_ONLY_FAMILIES.some(family => id.startsWith(family))
  }

  // 为模型添加视觉声明
  const withVision = (info) => {
    const inputModalities = Array.isArray(info?.inputModalities) ? [...info.inputModalities] : []
    if (!inputModalities.includes('text')) inputModalities.unshift('text')
    if (!inputModalities.includes('image')) inputModalities.push('image')
    return { ...info, provider: providerId, inputModalities }
  }

  try {
    const registration = llm.registerAdapter([providerId], {
      providerInfo(provider) {
        return { id: provider, name: 'Vision Bridge' }
      },
      async listModels(_provider, signal) {
        // 获取所有上游模型，过滤出需要 wrapper 的
        const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
        const allModels = []
        for (const info of providers) {
          const upstreamId = typeof info === 'string' ? info : info?.id
          if (!upstreamId || upstreamId === providerId) continue
          try {
            const models = await llm.listModels(upstreamId, signal)
            for (const model of models) {
              if (shouldWrap(model)) {
                allModels.push({
                  ...withVision(model),
                  name: `${model.name ?? model.id} (vision bridge)`,
                })
              }
            }
          } catch {}
        }
        return allModels
      },
      async resolveModel(_provider, model, signal) {
        // 查找上游模型
        const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
        for (const info of providers) {
          const upstreamId = typeof info === 'string' ? info : info?.id
          if (!upstreamId || upstreamId === providerId) continue
          try {
            const upstreamModel = await llm.resolveModelInfo(upstreamId, model, signal)
            if (upstreamModel && shouldWrap(upstreamModel)) {
              return { ...withVision(upstreamModel), id: model }
            }
          } catch {}
        }
        throw new Error(`Model "${model}" not found or does not need vision bridge`)
      },
      stream(options) {
        // 在请求时转换图片为文本证据
        return (async function* () {
          const converted = await convertImagesToEvidence(ctx, options.messages, config, evidenceCache)
          yield* llm.stream({ ...options, messages: converted })
        })()
      },
    })

    ownProviders.add(providerId)
    console.error(`[dsh-vision-bridge] Vision Bridge provider 注册成功`)
    return () => {
      ownProviders.delete(providerId)
      if (typeof registration === 'function') registration()
    }
  } catch (error) {
    console.error(`[dsh-vision-bridge] Provider 注册失败: ${error}`)
    return null
  }
}

// ============================================================================
// 图片转文本证据
// ============================================================================

async function convertImagesToEvidence(ctx, messages, config, evidenceCache) {
  const converted = []

  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      converted.push(message)
      continue
    }

    const newContent = []
    let hasImages = false

    for (const block of message.content) {
      // 检查是否是图片块
      if (block.type === 'image' || block.type === 'image_url') {
        hasImages = true
        const imageKey = block.attachment?.path || block.image_url?.url || ''

        // 检查缓存
        let evidence = evidenceCache.get(imageKey)
        if (!evidence) {
          try {
            const imageUrl = block.attachment
              ? await imageToDataUrl(ctx, block.attachment)
              : block.image_url?.url

            if (imageUrl) {
              const prompt = '请用中文详细描述这张图片的内容，包括文字、布局和语义信息。返回结构化 JSON。'
              evidence = await callVisionApi(config, [imageUrl], prompt)
              evidenceCache.set(imageKey, evidence)
            }
          } catch (error) {
            console.error(`[dsh-vision-bridge] 图片转换失败: ${error}`)
            evidence = {
              summary: `[图片识别失败: ${error.message}]`,
              ocr: { full_text: '', lines: [] },
              layout: { regions: [] },
              semantics: { scene: 'unknown', entities: [] },
              uncertainty: [`Recognition failed: ${error.message}`],
            }
          }
        }

        // 替换为文本证据
        newContent.push({
          type: 'text',
          text: `[图片证据]\n${JSON.stringify(evidence, null, 2)}`,
        })
      } else {
        newContent.push(block)
      }
    }

    converted.push({
      ...message,
      content: hasImages ? newContent : message.content,
    })
  }

  return converted
}

// ============================================================================
// Web 路由：粘贴上传和 Verdict 判断
// ============================================================================

// 图片魔数检测
const PASTE_SNIFFS = [
  {
    ext: '.png',
    test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { ext: '.jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', test: (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  { ext: '.webp', test: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
]
const PASTE_MAX_BYTES = 25 * 1024 * 1024

function registerPasteRoute(ctx, config, ownProviders) {
  if (!ctx.webServer?.register) return

  ctx.webServer.register({
    name: 'vision-bridge-paste',
    kind: 'exact',
    path: '/vision-bridge/paste',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }

      try {
        const chunks = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > PASTE_MAX_BYTES) {
            res.writeHead(413, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: `Image over ${PASTE_MAX_BYTES}-byte limit` }))
            req.destroy()
            return
          }
          chunks.push(chunk)
        }

        const buffer = Buffer.concat(chunks)
        const sniff = PASTE_SNIFFS.find((s) => s.test(buffer))
        if (!sniff) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not a recognized image (png/jpeg/gif/webp)' }))
          return
        }

        const { mkdtemp, writeFile } = await import('node:fs/promises')
        const { join } = await import('node:path')
        const { tmpdir } = await import('node:os')

        const root = join(tmpdir(), 'dsh-vision-bridge')
        const { mkdirSync } = await import('node:fs')
        mkdirSync(root, { recursive: true })

        const dir = await mkdtemp(join(root, 'paste-'))
        const file = join(dir, `paste${sniff.ext}`)
        await writeFile(file, buffer, { mode: 0o600 })

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ path: file }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(error?.message || error) }))
      }
    },
  })
}

function registerVerdictRoute(ctx, ownProviders) {
  if (!ctx.webServer?.register) return

  ctx.webServer.register({
    name: 'vision-bridge-verdict',
    kind: 'exact',
    path: '/vision-bridge/verdict',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }

      try {
        const url = new URL(req.url, 'http://localhost')
        const label = url.searchParams.get('model') || ''

        // 检查是否是 wrapper provider 自己
        if (/\(vision bridge\)/i.test(label)) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ takeover: false }))
          return
        }

        // 检查模型是否支持图片
        const llm = ctx.llm
        if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ takeover: false }))
          return
        }

        const lowered = label.toLowerCase()
        let matchedAny = false

        for (const info of llm.listProviders()) {
          const providerId = typeof info === 'string' ? info : info?.id
          if (!providerId || ownProviders?.has(providerId)) continue

          let models = []
          try {
            models = await llm.listModels(providerId)
          } catch {
            continue
          }

          for (const model of models) {
            for (const candidate of [model?.name, model?.id]) {
              if (typeof candidate !== 'string' || candidate.length < 3) continue
              if (!lowered.includes(candidate.toLowerCase())) continue

              const modalities = model?.inputModalities
              if (!Array.isArray(modalities) || modalities.includes('image')) {
                // 模型支持图片，不需要接管
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ takeover: false }))
                return
              }
              matchedAny = true
            }
          }
        }

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ takeover: matchedAny }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(error?.message || error) }))
      }
    },
  })
}
