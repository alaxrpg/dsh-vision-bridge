// dsh-vision-bridge: 为 DSH 纯文本模型提供视觉能力的通用桥接插件
// 支持任意 OpenAI 兼容多模态 API（SenseNova、OpenAI、Gemini、Ollama 等）
//
// v0.2.0: 接入 DSH settings 服务（settings.yaml 的 vision-bridge 命名空间），
// 配置可视化编辑（设置页「视觉桥接」分节）、热重载、连通性测试。

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================================
// 常量与预设
// ============================================================================

const DEFAULT_TIMEOUT_S = 90
const SETTINGS_NAMESPACE = 'vision-bridge'
const LEGACY_NAMESPACE = 'visionBridge'

// Provider 预设（客户端下拉 + 服务端缺省解析共用）
const PROVIDER_PRESETS = {
  sensennova: {
    label: 'SenseNova（sensenova-u1-fast）',
    baseUrl: 'https://token.sensenova.cn/v1',
    model: 'sensenova-u1-fast',
    apiKeyEnv: 'SENSENNOVA_API_KEY',
  },
  openai: {
    label: 'OpenAI（gpt-4o）',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  gemini: {
    label: 'Gemini（gemini-2.0-flash）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  ollama: {
    label: 'Ollama（llava 本地）',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llava',
    apiKeyEnv: 'OLLAMA_API_KEY',
  },
}

const CONFIG_DEFAULTS = {
  enabled: true,
  provider: 'sensennova',
  baseUrl: '',
  model: '',
  apiKeyEnv: '',
  apiKey: '',
  timeout: DEFAULT_TIMEOUT_S,
}

// 纯文本模型家族前缀（用于自动发现需要 wrapper 的模型）
const TEXT_ONLY_FAMILIES = ['deepseek', 'glm', 'qwen', 'mimo']

// 视觉模型名称模式（跳过 wrapper）
const VISION_ID_PATTERN = /(vl|ocr|janus|v\d|vision|multimodal|u1|u1\.5)/i

// ============================================================================
// 工具定义（vision_bridge_read_image 的输出 schema）
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
  const { baseUrl, apiKey, model, timeoutMs } = config

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
      'User-Agent': 'dsh-vision-bridge/0.2.0',
    },
    body,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
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
  return `data:${mime};base64,${base64}`
}

// ============================================================================
// 配置解析：settings 服务 > settings.yaml(vision-bridge) > 预设缺省
// ============================================================================

// 将用户 section 解析为运行时配置（预设填空 + 秒转毫秒 + API key 解析）
function resolveSection(section) {
  const merged = { ...CONFIG_DEFAULTS, ...(section ?? {}) }
  const preset = PROVIDER_PRESETS[merged.provider] ?? {}

  const baseUrl = merged.baseUrl?.trim() || preset.baseUrl || ''
  const model = merged.model?.trim() || preset.model || ''
  const apiKeyEnv = merged.apiKeyEnv?.trim() || preset.apiKeyEnv || ''
  const timeoutS = Number.isFinite(merged.timeout) && merged.timeout >= 5 && merged.timeout <= 600
    ? merged.timeout
    : DEFAULT_TIMEOUT_S

  let apiKey = typeof merged.apiKey === 'string' ? merged.apiKey.trim() : ''
  let keySource = 'none'
  if (apiKey) {
    keySource = 'settings'
  } else if (apiKeyEnv && process.env[apiKeyEnv]) {
    apiKey = process.env[apiKeyEnv]
    keySource = 'env'
  }

  return {
    enabled: merged.enabled !== false,
    provider: merged.provider || 'sensennova',
    baseUrl,
    model,
    apiKeyEnv,
    apiKey,
    keySource,
    timeout: timeoutS,
    timeoutMs: timeoutS * 1000,
  }
}

// settings.yaml 直读兜底（settings 服务不可用时仍可工作；兼容旧 visionBridge 键）
function readSettingsSection() {
  const candidates = [
    process.env.DSH_SETTINGS_PATH,
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'settings.yaml'),
    join(homedir(), '.dsh', 'settings.yaml'),
  ]
  for (const file of candidates) {
    if (!file) continue
    try {
      const text = readFileSync(file, 'utf8')
      // 轻量解析顶层 vision-bridge / visionBridge 段（避免依赖 yaml 库）
      const section = extractTopLevelSection(text, SETTINGS_NAMESPACE)
        ?? extractTopLevelSection(text, LEGACY_NAMESPACE)
      if (section) return section
    } catch { /* 文件不存在则尝试下一个候选 */ }
  }
  return {}
}

function extractTopLevelSection(text, key) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => new RegExp(`^${key}\\s*:`).test(l))
  if (start === -1) return null
  const out = {}
  const entry = /^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/.test(line)) break // 下一个顶层键
    const m = entry.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (value === '' || value === 'null' || value === '~') continue
    value = value.replace(/^['"]|['"]$/g, '')
    if (value === 'true') out[m[1]] = true
    else if (value === 'false') out[m[1]] = false
    else if (/^-?\d+(\.\d+)?$/.test(value)) out[m[1]] = Number(value)
    else out[m[1]] = value
  }
  return out
}

// 加载 schemastery schema（宿主提供；不可用时退化为带缺省的透传 schema）
async function loadConfigSchema() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    const Schema = mod.default ?? mod
    return Schema.object({
      enabled: Schema.boolean().default(true),
      provider: Schema.string().default('sensennova'),
      baseUrl: Schema.string().default(''),
      model: Schema.string().default(''),
      apiKeyEnv: Schema.string().default(''),
      apiKey: Schema.string().default(''),
      timeout: Schema.number().default(DEFAULT_TIMEOUT_S),
    })
  } catch {
    const passthrough = (value) => ({ ...CONFIG_DEFAULTS, ...(value ?? {}) })
    passthrough.toJSON = () => ({ type: 'object' })
    return passthrough
  }
}

// ============================================================================
// 插件主逻辑
// ============================================================================

export const name = 'dsh-vision-bridge'
export const inject = ['tools', 'llm', 'webServer']

export function apply(ctx, config = {}) {
  // 运行时可变状态：state.config 是当前生效的 resolveSection() 结果
  const state = {
    config: null,        // 当前生效配置
    settingsFace: null,  // { service } 可写设置面（settings 服务接入后非空）
    providerRegistered: false,
  }

  const setState = (resolved, source) => {
    state.config = resolved
    const where = resolved.keySource === 'settings'
      ? 'settings.yaml'
      : resolved.keySource === 'env' ? resolved.apiKeyEnv : '缺失'
    console.error(
      `[dsh-vision-bridge] 配置已加载(${source}): provider=${resolved.provider} model=${resolved.model} `
      + `enabled=${resolved.enabled} key=${where}`,
    )
    return resolved
  }

  // section（用户层）优先，插件 config（cordis.patch.yml config: 段）作底座
  const refreshConfig = (section, source) => {
    const base = {}
    if (config && typeof config === 'object') {
      for (const key of Object.keys(CONFIG_DEFAULTS)) {
        if (config[key] !== undefined) base[key] = config[key]
      }
    }
    return setState(resolveSection({ ...base, ...(section ?? {}) }), source)
  }

  // 初始解析：settings.yaml 直读（settings 服务接入后被权威值覆盖）
  refreshConfig(readSettingsSection(), 'settings.yaml')

  if (typeof ctx.inject === 'function') {
    // 可选接入 settings 服务：注册命名空间 + 热重载 + 可写面
    ctx.inject(['settings'], async (sctx) => {
      const schema = await loadConfigSchema()
      try {
        const scope = sctx.settings.register(SETTINGS_NAMESPACE, schema, { base: config ?? {} })
        state.settingsFace = { service: sctx.settings }

        const applyScope = () => {
          try {
            // scope.get() 已合并 schema 缺省 + base + 用户段
            refreshConfig(scope.get(), 'settings 服务')
          } catch (error) {
            console.error(`[dsh-vision-bridge] 配置解析失败，保留旧值: ${error?.message ?? error}`)
          }
        }
        applyScope()
        scope.watch(() => applyScope())
      } catch (error) {
        // 命名空间已被其他实例注册等场景：退回直读模式
        console.error(`[dsh-vision-bridge] settings 命名空间注册失败(退回直读模式): ${error?.message ?? error}`)
      }
    })

    ctx.inject(['llm'], (scope) => {
      registerVisionProvider(scope, state)
    })

    ctx.inject(['webServer'], (scope) => {
      registerPasteRoute(scope, state)
      registerVerdictRoute(scope, state)
      registerConfigRoutes(scope, state)
    })
  } else {
    registerVisionProvider(ctx, state)
    registerPasteRoute(ctx, state)
    registerVerdictRoute(ctx, state)
    registerConfigRoutes(ctx, state)
  }

  // 工具注册（不依赖 settings 服务）
  registerReadImageTool(ctx, state)
}

// ============================================================================
// vision_bridge_read_image 工具
// ============================================================================

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
  return `data:${mime};base64,${base64}`
}

function registerReadImageTool(ctx, state) {
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
    isConcurrencySafe: () => true,
    async execute(args) {
      if (typeof args?.path !== 'string' || args.path.trim() === '') {
        throw new Error('vision_bridge_read_image needs a non-empty "path"')
      }

      const config = state.config
      if (!config?.apiKey) {
        throw new Error('vision bridge 未配置 API key（设置 → 视觉桥接）')
      }

      const prompt = args.prompt || '请用中文详细描述这张图片的内容，包括文字、布局和语义信息'
      const images = [await resolveImagePath(ctx, args.path)]
      return await callVisionApi(config, images, prompt)
    },
  }

  try {
    ctx.tools.register({ ...readImageTool, timeoutMs: (state.config?.timeoutMs ?? 90_000) + 20_000 })
  } catch (error) {
    console.error(`[dsh-vision-bridge] 工具注册失败: ${error}`)
  }
}

// ============================================================================
// Wrapper Provider 注册
// ============================================================================

function registerVisionProvider(ctx, state) {
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
        // 插件停用时不暴露桥接模型
        if (!state.config?.enabled) return []

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
          const config = state.config
          if (!config?.enabled || !config?.apiKey) {
            throw new Error('vision bridge 未启用或缺少 API key（设置 → 视觉桥接）')
          }
          const converted = await convertImagesToEvidence(ctx, options.messages, config)
          yield* llm.stream({ ...options, messages: converted })
        })()
      },
    })

    state.providerRegistered = true
    console.error(`[dsh-vision-bridge] Vision Bridge provider 注册成功`)
    return () => {
      state.providerRegistered = false
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

// 证据缓存：挂在 config 对象上（配置刷新 = 换新对象 = 缓存自动清空）
function cacheOf(config) {
  if (!config.__cache) {
    Object.defineProperty(config, '__cache', { value: new Map(), enumerable: false })
  }
  return config.__cache
}

async function convertImagesToEvidence(ctx, messages, config) {
  const converted = []
  const cache = cacheOf(config)

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
        let evidence = cache.get(imageKey)
        if (!evidence) {
          try {
            const imageUrl = block.attachment
              ? await imageToDataUrl(ctx, block.attachment)
              : block.image_url?.url

            if (imageUrl) {
              const prompt = '请用中文详细描述这张图片的内容，包括文字、布局和语义信息。返回结构化 JSON。'
              evidence = await callVisionApi(config, [imageUrl], prompt)
              if (cache.size > 64) cache.clear()
              cache.set(imageKey, evidence)
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
// Web 路由：粘贴上传与 Verdict 判断
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
const JSON_MAX_BYTES = 1 << 20

// 同源防护：跨站请求拒绝写操作
function sameOrigin(req) {
  const site = req.headers?.['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'none'
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > JSON_MAX_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function registerPasteRoute(ctx, state) {
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
            sendJson(res, 413, { error: `Image over ${PASTE_MAX_BYTES}-byte limit` })
            req.destroy()
            return
          }
          chunks.push(chunk)
        }

        const buffer = Buffer.concat(chunks)
        const sniff = PASTE_SNIFFS.find((s) => s.test(buffer))
        if (!sniff) {
          sendJson(res, 400, { error: 'Not a recognized image (png/jpeg/gif/webp)' })
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

        sendJson(res, 200, { path: file })
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message || error) })
      }
    },
  })
}

function registerVerdictRoute(ctx, state) {
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

        // 插件停用时不接管粘贴
        if (!state.config?.enabled) {
          sendJson(res, 200, { takeover: false })
          return
        }

        // 检查是否是 wrapper provider 自己
        if (/\(vision bridge\)/i.test(label)) {
          sendJson(res, 200, { takeover: false })
          return
        }

        // 检查模型是否支持图片
        const llm = ctx.llm
        if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
          sendJson(res, 200, { takeover: false })
          return
        }

        const lowered = label.toLowerCase()
        let matchedAny = false

        for (const info of llm.listProviders()) {
          const providerId = typeof info === 'string' ? info : info?.id
          if (!providerId || providerId === 'vision-bridge') continue

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
                sendJson(res, 200, { takeover: false })
                return
              }
              matchedAny = true
            }
          }
        }

        sendJson(res, 200, { takeover: matchedAny })
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message || error) })
      }
    },
  })
}

// ============================================================================
// 可视化配置路由：GET/POST /vision-bridge/config、POST /vision-bridge/test
// ============================================================================

// 脱敏视图：永不回传 apiKey 原文
function sanitizedView(state) {
  const config = state.config ?? resolveSection({})
  return {
    enabled: config.enabled,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyEnv: config.apiKeyEnv,
    timeout: config.timeout,
    keySource: config.keySource,
    keyResolved: Boolean(config.apiKey),
  }
}

function statusView(state) {
  return {
    providerRegistered: state.providerRegistered,
    settingsService: Boolean(state.settingsFace),
    namespace: SETTINGS_NAMESPACE,
    presets: Object.fromEntries(
      Object.entries(PROVIDER_PRESETS).map(([id, preset]) => [
        id,
        { label: preset.label, baseUrl: preset.baseUrl, model: preset.model, apiKeyEnv: preset.apiKeyEnv },
      ]),
    ),
  }
}

function currentRevision(state) {
  try {
    const face = state.settingsFace
    if (!face) return undefined
    const descriptor = face.service.describe({ redactSecrets: true })
      .find((candidate) => candidate.ns === SETTINGS_NAMESPACE)
    return descriptor?.revision
  } catch {
    return undefined
  }
}

function registerConfigRoutes(ctx, state) {
  if (!ctx.webServer?.register) return

  ctx.webServer.register({
    name: 'vision-bridge-config',
    kind: 'exact',
    path: '/vision-bridge/config',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        sendJson(res, 200, {
          config: sanitizedView(state),
          status: statusView(state),
          revision: currentRevision(state),
        })
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }

      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: '跨站请求被拒绝' })
        return
      }

      try {
        const body = await readJsonBody(req)
        const patch = body?.patch
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          sendJson(res, 400, { error: 'patch 必须是对象' })
          return
        }

        // 只接受白名单字段
        const allowed = ['enabled', 'provider', 'baseUrl', 'model', 'apiKeyEnv', 'apiKey', 'timeout']
        const clean = {}
        for (const key of allowed) {
          if (patch[key] === undefined) continue
          if (key === 'enabled') {
            clean.enabled = Boolean(patch.enabled)
          } else if (key === 'timeout') {
            const t = Number(patch.timeout)
            if (!Number.isFinite(t) || t < 5 || t > 600) {
              sendJson(res, 400, { error: 'timeout 需在 5–600 秒之间' })
              return
            }
            clean.timeout = t
          } else if (typeof patch[key] === 'string') {
            clean[key] = patch[key]
          }
        }

        const face = state.settingsFace
        if (!face) {
          sendJson(res, 503, {
            error: `settings 服务不可用：请直接编辑 settings.yaml 的 ${SETTINGS_NAMESPACE} 段`,
          })
          return
        }

        await face.service.update(SETTINGS_NAMESPACE, clean, body.revision)
        sendJson(res, 200, {
          config: sanitizedView(state),
          status: statusView(state),
          revision: currentRevision(state),
          message: '已保存并热生效',
        })
      } catch (error) {
        const name = error?.constructor?.name
        if (name === 'SettingsConflictError') {
          sendJson(res, 409, {
            error: '配置已被其他窗口修改，请刷新后重试',
            revision: currentRevision(state),
          })
          return
        }
        console.error(`[dsh-vision-bridge] 配置保存失败: ${error?.message ?? error}`)
        sendJson(res, 400, { error: String(error?.message || error) })
      }
    },
  })

  ctx.webServer.register({
    name: 'vision-bridge-test',
    kind: 'exact',
    path: '/vision-bridge/test',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: '跨站请求被拒绝' })
        return
      }

      const config = state.config
      if (!config?.apiKey) {
        sendJson(res, 400, { error: `缺少 API key（${config?.apiKeyEnv || '未配置 apiKeyEnv'}）` })
        return
      }

      // 8x8 纯色测试 PNG
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8DwnwEPYMInOXwUAADtmwTD8M0nAAAAAElFTkSuQmCC',
        'base64',
      )
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`

      const started = Date.now()
      try {
        const result = await callVisionApi(
          { ...config, timeoutMs: Math.min(config.timeoutMs, 30_000) },
          [dataUrl],
          '这是一张 8x8 纯色测试图。只需回答:ok',
        )
        sendJson(res, 200, {
          ok: true,
          latencyMs: Date.now() - started,
          model: config.model,
          provider: config.provider,
          sample: typeof result?.summary === 'string' ? result.summary.slice(0, 120) : undefined,
        })
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          latencyMs: Date.now() - started,
          model: config.model,
          provider: config.provider,
          error: String(error?.message || error).slice(0, 500),
        })
      }
    },
  })
}
