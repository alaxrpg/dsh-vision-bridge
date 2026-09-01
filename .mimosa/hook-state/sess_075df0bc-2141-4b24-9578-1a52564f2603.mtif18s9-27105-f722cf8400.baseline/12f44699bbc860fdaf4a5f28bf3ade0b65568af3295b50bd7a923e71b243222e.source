// dsh-vision-bridge: 为 DSH 纯文本模型提供视觉能力的通用桥接插件
// 支持 DSH 已注册 Provider，以及无厂商预设的 OpenAI 兼容直连 Provider
//
// v0.2.1: API key 改经 DSH credentials 服务读取（ctx.credentials），
// 与 DSH 模型配置/凭据页同一渠道（进程环境 → ~/.dsh/.credentials.yaml → .env），
// 直接读环境变量仅作 credentials 服务不可用时的兜底。
//
// v0.2.0: 接入 DSH settings 服务（settings.yaml 的 vision-bridge 命名空间），
// 配置可视化编辑（设置页「视觉桥接」分节）、热重载、连通性测试。

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================================
// 常量与缺省值
// ============================================================================

const DEFAULT_TIMEOUT_S = 90
const SETTINGS_NAMESPACE = 'vision-bridge'
const LEGACY_NAMESPACE = 'visionBridge'
const PASTE_REFERENCE_SCHEME = 'vision:'

const CONFIG_DEFAULTS = {
  enabled: true,
  // dsh：复用 DSH 已注册 Provider；custom：本插件私有的 OpenAI 兼容直连。
  providerMode: 'dsh',
  provider: '',
  baseUrl: '',
  model: '',
  apiKeyEnv: '',
  apiKey: '',
  timeout: DEFAULT_TIMEOUT_S,
}

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
      'User-Agent': 'dsh-vision-bridge/0.2.1',
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

  return parseVisionResult(content_text)
}

function parseVisionResult(contentText) {
  // 尝试解析结构化 JSON，失败则返回纯文本
  try {
    return JSON.parse(contentText)
  } catch {
    return {
      summary: contentText,
      ocr: { full_text: contentText, lines: [] },
      layout: { regions: [] },
      semantics: { scene: 'unknown', entities: [] },
      uncertainty: ['Response was not structured JSON'],
    }
  }
}

// DSH 已注册 Provider 的调用通道。图片先保存为 DSH attachment，再交给
// 对应 adapter 解析；这与本插件的 OpenAI 兼容直连模式完全分离。
async function callDshVision(state, config, paths, prompt, signal) {
  if (!state.llm || typeof state.llm.stream !== 'function') {
    throw new Error('DSH LLM 服务不可用，无法调用已添加的 Provider')
  }
  if (!state.attachments || typeof state.attachments.saveImage !== 'function') {
    throw new Error('DSH attachment 服务不可用，无法向已添加的 Provider 传递图片')
  }
  if (!config.provider || !config.model) {
    throw new Error('请选择 DSH Provider 和视觉模型')
  }

  const content = [{ type: 'text', text: prompt }]
  for (const path of paths) {
    const image = await loadImageSource(path, state)
    const ref = await state.attachments.saveImage({
      data: image.data,
      mediaType: image.mediaType,
      ...(image.name ? { name: image.name } : {}),
    })
    content.push({
      type: 'image',
      attachment: {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...(ref.name ? { name: ref.name } : {}),
      },
    })
  }

  let text = ''
  for await (const chunk of state.llm.stream({
    provider: config.provider,
    model: config.model,
    maxTokens: 4096,
    signal: signal ?? AbortSignal.timeout(config.timeoutMs),
    messages: [{
      role: 'user',
      content,
      source: { kind: 'plugin', plugin: name },
    }],
  })) {
    if (typeof chunk?.text === 'string') text += chunk.text
  }
  if (!text) throw new Error('DSH Provider 返回了空响应')
  return parseVisionResult(text)
}

async function callConfiguredVision(state, config, paths, prompt, signal) {
  if (config.providerMode === 'dsh') return callDshVision(state, config, paths, prompt, signal)
  if (!config.provider || !config.baseUrl || !config.model) {
    throw new Error('自定义 Provider 的名称、Base URL 和视觉模型均不能为空')
  }
  if (!config.apiKey) throw new Error('自定义 Provider 未配置 API Key')
  const images = []
  for (const path of paths) images.push(await resolveImagePath(path, state))
  return callVisionApi(config, images, prompt, signal)
}

// ============================================================================
// 配置解析：settings 服务 > settings.yaml(vision-bridge) > 空白缺省
// ============================================================================

// 将用户 section 解析为运行时配置。旧版没有 providerMode 的配置，若已填写
// OpenAI 兼容连接字段则自动保留为 custom，避免更新后丢失用户的既有连接。
function resolveSection(section) {
  const declaredMode = section && Object.hasOwn(section, 'providerMode')
    ? section.providerMode
    : undefined
  const merged = { ...CONFIG_DEFAULTS, ...(section ?? {}) }
  const hasLegacyCustomFields = Boolean(merged.baseUrl || merged.apiKeyEnv || merged.apiKey)
  const providerMode = declaredMode === 'dsh' || declaredMode === 'custom'
    ? declaredMode
    : hasLegacyCustomFields ? 'custom' : 'dsh'
  const baseUrl = typeof merged.baseUrl === 'string' ? merged.baseUrl.trim() : ''
  const model = typeof merged.model === 'string' ? merged.model.trim() : ''
  const apiKeyEnv = typeof merged.apiKeyEnv === 'string' ? merged.apiKeyEnv.trim() : ''
  const timeoutS = Number.isFinite(merged.timeout) && merged.timeout >= 5 && merged.timeout <= 600
    ? merged.timeout
    : DEFAULT_TIMEOUT_S

  const apiKey = providerMode === 'custom' && typeof merged.apiKey === 'string' ? merged.apiKey.trim() : ''
  const keySource = providerMode === 'dsh' ? 'dsh' : (apiKey ? 'settings' : (apiKeyEnv ? 'pending' : 'none'))

  return {
    enabled: merged.enabled !== false,
    providerMode,
    provider: typeof merged.provider === 'string' ? merged.provider.trim() : '',
    baseUrl,
    model,
    apiKeyEnv,
    apiKey,
    keySource,
    timeout: timeoutS,
    timeoutMs: timeoutS * 1000,
  }
}

// 加载 credentials 服务的 credentialRef 商标函数（宿主提供 @deepseek-ai/dsh-credentials；
// 不可用时退化为透传，resolve 仍按字符串工作）
let credentialRefLoader
async function loadCredentialRef() {
  if (credentialRefLoader) return credentialRefLoader
  try {
    const mod = await import('@deepseek-ai/dsh-credentials')
    credentialRefLoader = mod.credentialRef ?? ((v) => v)
  } catch {
    credentialRefLoader = ((v) => v)
  }
  return credentialRefLoader
}

// 凭据解析：优先与 DSH 模型配置/凭据页同一渠道（ctx.credentials），
// 不可用或未命中时才退回进程环境变量，保证无 credentials 服务的旧版 DSH 可用。
async function resolveApiKey(config, state) {
  if (config.providerMode === 'dsh') return config
  if (config.keySource !== 'pending' || !config.apiKeyEnv) return config

  const ref = config.apiKeyEnv
  if (state.credentials) {
    try {
      const refOf = await loadCredentialRef()
      const hit = await state.credentials.resolve(refOf(ref))
      if (hit?.value) return { ...config, apiKey: hit.value, keySource: 'credentials' }
    } catch { /* 继续尝试环境变量，错误状态由设置页展示 */ }
  }

  const envValue = process.env[config.apiKeyEnv]
  if (typeof envValue === 'string' && envValue.trim()) {
    return { ...config, apiKey: envValue.trim(), keySource: 'env' }
  }

  return { ...config, keySource: 'none' }
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
      providerMode: Schema.union(['dsh', 'custom']).default('dsh'),
      provider: Schema.string().default(''),
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
export const inject = ['tools', 'webServer']

export function apply(ctx, config = {}) {
  // 运行时可变状态：state.config 是当前生效的 resolveSection() + resolveApiKey() 结果
  const state = {
    config: null,        // 当前生效配置
    settingsFace: null,  // { service } 可写设置面（settings 服务接入后非空）
    settingsScope: null, // 已注册的 settings scope，用于保存后立即回读
    credentials: null,   // DSH 凭据服务（与模型配置/凭据页同一密钥渠道）
    llm: null,           // 可选 LLM 服务，仅用于判断当前模型是否原生支持图片
    attachments: null,   // DSH attachment store，供已添加 Provider 接收图片
    refreshConfig: null, // 路由保存后回读配置的运行时回调
  }
  try {
    state.attachments = ctx.attachments ?? (typeof ctx.get === 'function' ? ctx.get('attachments') : null)
  } catch { /* 服务尚未就绪时由下方 inject 补齐 */ }

  const setState = (resolved, source) => {
    state.config = resolved
    return resolved
  }

  // section（用户层）优先，插件 config（cordis.patch.yml config: 段）作底座
  // 异步：apiKey 需经 credentials 服务解析（resolve 失败时状态保持旧值）
  const refreshConfig = async (section, source) => {
    const base = {}
    if (config && typeof config === 'object') {
      for (const key of Object.keys(CONFIG_DEFAULTS)) {
        if (config[key] !== undefined) base[key] = config[key]
      }
    }
    try {
      const merged = { ...base, ...(section ?? {}) }
      return setState(await resolveApiKey(resolveSection(merged), state), source)
    } catch {
      // 保留上一份可用配置；运行状态由配置 API/页面展示。
      return state.config
    }
  }
  state.refreshConfig = refreshConfig

  // 初始解析：settings.yaml 直读（settings/credentials 服务接入后被权威值覆盖）
  refreshConfig(readSettingsSection(), 'settings.yaml')

  if (typeof ctx.inject === 'function') {
    // 可选接入 credentials 服务：与 DSH 模型配置同一密钥渠道（凭据页/模型配置存储的 key 立即生效）
    ctx.inject(['credentials'], (sctx) => {
      state.credentials = sctx.credentials
      refreshConfig(readSettingsSection(), 'settings.yaml')
      // 凭据被修改/轮换后热重载
      sctx.on('credentials/reference-updated', (ref) => {
        if (!ref || ref === state.config?.apiKeyEnv) {
          refreshConfig(readSettingsSection(), 'settings.yaml')
        }
      })
    })

    // 不把 llm 设为插件硬依赖：不注册 Provider 也不改变模型配置；
    // 仅在服务可用时缓存它，供 /verdict 判断原生图片能力。
    ctx.inject(['llm'], (sctx) => {
      state.llm = sctx.llm
    })

    ctx.inject(['attachments'], (sctx) => {
      state.attachments = sctx.attachments
    })

    // 可选接入 settings 服务：注册命名空间 + 热重载 + 可写面
    ctx.inject(['settings'], async (sctx) => {
      const schema = await loadConfigSchema()
      try {
        const scope = sctx.settings.register(SETTINGS_NAMESPACE, schema, { base: config ?? {} })
        state.settingsFace = { service: sctx.settings }
        state.settingsScope = scope

        const applyScope = () => {
          // scope.get() 已合并 schema 缺省 + base + 用户段
          refreshConfig(scope.get(), 'settings 服务')
        }
        applyScope()
        scope.watch(() => applyScope())
      } catch {
        // 命名空间已被其他实例注册等场景：退回直读模式
      }
    })

    ctx.inject(['webServer'], (scope) => {
      registerPasteRoute(scope, state)
      registerVerdictRoute(scope, state)
      registerConfigRoutes(scope, state)
    })
  } else {
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

async function loadImageSource(path, state) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    // DSH Provider 路径会把图片读入本机 attachment store。当前工具的 URL
    // 参数没有经过 SSRF 约束，因此不在该模式下替宿主抓取任意网络地址。
    throw new Error('DSH Provider 模式暂只支持本地文件或 data URL；请先将远程图片保存到本地')
  }

  if (path.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(path)
    if (!match) throw new Error('仅支持 base64 编码的图片 data URL')
    return { data: Buffer.from(match[2], 'base64'), mediaType: match[1] }
  }

  const { readFile, stat } = await import('node:fs/promises')
  const { resolve, basename } = await import('node:path')
  const { tmpdir } = await import('node:os')

  let sourcePath = path
  if (path.startsWith(`${PASTE_REFERENCE_SCHEME}//`)) {
    const imageId = path.slice(`${PASTE_REFERENCE_SCHEME}//`.length)
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(imageId)) {
      throw new Error('无效的视觉附件 ID')
    }
    const directory = join(tmpdir(), 'dsh-vision-bridge', `paste-${imageId}`)
    sourcePath = null
    for (const ext of ['.png', '.jpg', '.gif', '.webp']) {
      const candidate = join(directory, `paste${ext}`)
      try {
        const candidateStat = await stat(candidate)
        if (candidateStat.isFile()) {
          sourcePath = candidate
          break
        }
      } catch { /* 继续尝试下一种允许的图片扩展名 */ }
    }
    if (!sourcePath) throw new Error(`图片 #${imageId} 不存在或已过期`)
  }

  const filePath = resolve(sourcePath)
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) {
    throw new Error(`File not found: ${filePath}`)
  }

  const data = await readFile(filePath)
  return { data, mediaType: sniffMime(data) || guessMime(filePath), name: basename(filePath) }
}

async function resolveImagePath(path, state) {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path
  const image = await loadImageSource(path, state)
  return `data:${image.mediaType};base64,${image.data.toString('base64')}`
}

function registerReadImageTool(ctx, state) {
  const readImageTool = {
    name: 'vision_bridge_read_image',
    description:
      'Read an image through the vision bridge. When the user message contains “「▧ 图片 #ID」”, read vision://ID using that exact ID. Also accepts a local file path or an http(s) URL. Returns structured evidence with OCR text, layout regions, and semantics.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'For “「▧ 图片 #ID」” use vision://ID; otherwise an absolute local path or http(s) URL',
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
      if (!config?.enabled) {
        throw new Error('vision bridge 已停用（设置 → 视觉桥接开启）')
      }
      if (config?.providerMode === 'custom' && !config?.apiKey) {
        throw new Error('vision bridge 未配置 API key（设置 → 视觉桥接）')
      }

      const prompt = args.prompt || '请用中文详细描述这张图片的内容，包括文字、布局和语义信息'
      return await callConfiguredVision(state, config, [args.path], prompt)
    },
  }

  try {
    ctx.tools.register({ ...readImageTool, timeoutMs: (state.config?.timeoutMs ?? 90_000) + 20_000 })
  } catch { /* 宿主不支持工具注册时保持静默，配置页仍可用 */ }
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
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: '跨站请求被拒绝' })
        return
      }

      try {
        if (!state.config?.enabled) {
          sendJson(res, 403, { error: '视觉桥接已停用（设置 → 视觉桥接开启）' })
          return
        }

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

        const imageId = dir.slice(root.length + 1).replace(/^paste-/, '')
        sendJson(res, 200, { id: imageId })
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message || error) })
      }
    },
  })
}

// 从宿主的当前模型标签判断是否需要接管粘贴。标签含 Provider
// 时只采信该 Provider；标签不含 Provider 且同名模型横跨多个 Provider 时，
// 能力归属无法确定，安全放行宿主原生粘贴，避免误拦截。
export function decidePasteTakeover(label, catalogs) {
  const lowered = String(label || '').toLowerCase()
  const matches = []
  for (const catalog of catalogs) {
    const providerLabels = [catalog.providerId, catalog.providerName, catalog.providerLabel]
      .filter((value) => typeof value === 'string' && value.length >= 2)
    const providerMatchLength = providerLabels.reduce((longest, value) => (
      lowered.includes(value.toLowerCase()) ? Math.max(longest, value.length) : longest
    ), 0)
    for (const model of catalog.models ?? []) {
      const modelLabels = [model?.name, model?.id]
        .filter((value) => typeof value === 'string' && value.length >= 3)
      if (!modelLabels.some((value) => lowered.includes(value.toLowerCase()))) continue
      matches.push({
        providerId: catalog.providerId,
        providerMatchLength,
        imageCapable: Array.isArray(model?.inputModalities) && model.inputModalities.includes('image'),
      })
    }
  }

  const longestProviderMatch = Math.max(0, ...matches.map((match) => match.providerMatchLength))
  const explicit = longestProviderMatch > 0
    ? matches.filter((match) => match.providerMatchLength === longestProviderMatch)
    : []
  const relevant = explicit.length > 0 ? explicit : matches
  if (relevant.length === 0) return false
  if (explicit.length === 0) {
    // 跨 Provider 同名模型：能力归属不明时才放行宿主原生粘贴，避免误拦截。
    // 若所有同名模型能力一致（如各家的 deepseek-v4-flash 都是纯文本），
    // 接管与否是确定的，不应因“跨 Provider 同名”而错误放行。
    const capabilities = new Set(relevant.map((match) => match.imageCapable))
    if (capabilities.size > 1) return false
    return !relevant[0].imageCapable
  }
  return !relevant.some((match) => match.imageCapable)
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

        // 检查模型是否支持图片。注意：大多数 adapter 不声明 inputModalities
        //（undefined），视为纯文本模型 → 接管粘贴；只有明确声明含 image 才不接管。
        const llm = state.llm
        if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
          sendJson(res, 200, { takeover: false })
          return
        }

        const catalogs = []

        for (const info of llm.listProviders()) {
          const providerId = typeof info === 'string' ? info : info?.id
          if (!providerId || providerId === 'vision-bridge') continue

          let models = []
          try {
            models = await llm.listModels(providerId)
          } catch {
            continue
          }
          catalogs.push({
            providerId,
            providerName: typeof info === 'object' ? info?.name : undefined,
            providerLabel: typeof info === 'object' ? info?.label : undefined,
            models,
          })
        }

        sendJson(res, 200, { takeover: decidePasteTakeover(label, catalogs) })
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
    providerMode: config.providerMode,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyEnv: config.apiKeyEnv,
    timeout: config.timeout,
    keySource: config.keySource,
    keyResolved: Boolean(config.apiKey),
    managedByDsh: config.providerMode === 'dsh',
  }
}

async function dshProviderCatalog(state) {
  const llm = state.llm
  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return []

  const out = []
  for (const info of llm.listProviders()) {
    const id = typeof info === 'string' ? info : info?.id
    if (!id || id === 'vision-bridge') continue
    try {
      const models = await llm.listModels(id)
      out.push({
        id,
        label: typeof info === 'object' && typeof info?.name === 'string' ? info.name : id,
        models: (Array.isArray(models) ? models : []).map((model) => ({
          id: model?.id ?? model?.name,
          label: model?.name ?? model?.id,
          imageCapable: Array.isArray(model?.inputModalities) && model.inputModalities.includes('image'),
        })).filter((model) => typeof model.id === 'string' && model.id.length > 0),
      })
    } catch {
      // 个别 Provider 的模型目录失败不应阻断设置页；保留其余可用 Provider。
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

async function statusView(state) {
  return {
    settingsService: Boolean(state.settingsFace),
    credentialsService: Boolean(state.credentials),
    llmService: Boolean(state.llm),
    attachmentService: Boolean(state.attachments),
    namespace: SETTINGS_NAMESPACE,
    dshProviders: await dshProviderCatalog(state),
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
          status: await statusView(state),
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
        const allowed = ['enabled', 'providerMode', 'provider', 'baseUrl', 'model', 'apiKeyEnv', 'apiKey', 'clearApiKey', 'timeout']
        const clean = {}
        for (const key of allowed) {
          if (patch[key] === undefined) continue
          if (key === 'enabled') {
            clean.enabled = Boolean(patch.enabled)
          } else if (key === 'clearApiKey') {
            if (patch.clearApiKey === true) clean.apiKey = ''
          } else if (key === 'providerMode') {
            if (patch.providerMode !== 'dsh' && patch.providerMode !== 'custom') {
              sendJson(res, 400, { error: 'providerMode 仅支持 dsh 或 custom' })
              return
            }
            clean.providerMode = patch.providerMode
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
        // 某些 settings 实现的 watch 回调是异步的；先用 scope.get() 回读，
        // 再生成响应，避免页面保存后仍显示旧值、开关延迟生效。
        if (state.settingsScope?.get) {
          await state.refreshConfig(state.settingsScope.get(), 'settings 服务（保存后回读）')
        } else {
          await state.refreshConfig(readSettingsSection(), 'settings.yaml（保存后回读）')
        }
        sendJson(res, 200, {
          config: sanitizedView(state),
          status: await statusView(state),
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
      if (config?.providerMode === 'custom' && !config?.apiKey) {
        sendJson(res, 400, { error: `缺少 API key（${config?.apiKeyEnv || '未配置 apiKeyEnv'}）` })
        return
      }
      if (!config?.provider || !config?.model) {
        sendJson(res, 400, { error: '请选择 Provider 和视觉模型' })
        return
      }

      // 64x64 纯色测试 PNG（8x8 过小会被部分服务端拒绝：invalid image base64 content）
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAl0lEQVR4nO3QMREAIAzAwMqpfz14ARk/kOH3XObs3p+NDtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QHtG7LH/UgR9aQAAAABJRU5ErkJggg==',
        'base64',
      )
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`

      const started = Date.now()
      try {
        const result = await callConfiguredVision(
          state,
          { ...config, timeoutMs: Math.min(config.timeoutMs, 30_000) },
          [dataUrl],
          '这是一张纯色测试图。只需回答:ok',
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
