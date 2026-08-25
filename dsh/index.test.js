import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const serverSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const plugin = await import('./index.js')

describe('dsh-vision-bridge server', () => {
  it('should be importable and export plugin face', async () => {
    const mod = await import('./index.js')
    assert.ok(mod.apply, 'apply function should exist')
    assert.equal(mod.name, 'dsh-vision-bridge')
    assert.deepEqual(mod.inject, ['tools', 'webServer'])
  })

  it('should discover DSH providers without vendor presets', () => {
    assert.ok(serverSource.includes('async function dshProviderCatalog'))
    assert.ok(serverSource.includes('llm.listProviders()'))
    assert.ok(serverSource.includes('await llm.listModels(id)'))
    assert.ok(!serverSource.includes('PROVIDER_PRESETS'))
    assert.ok(!serverSource.includes('MODEL_ALIASES'))
    assert.ok(!clientSource.includes('presetIds'))
  })

  it('should not register any wrapper provider on startup', async () => {
    // 不做启动时的 provider 注册/检查（此前 registerAdapter 报
    // adapter.providerRetryPolicy is not a function，且该功能没有必要）
    assert.ok(!serverSource.includes('registerAdapter'), 'must not touch llm.registerAdapter')
    assert.ok(!serverSource.includes('registerVisionProvider'))
    assert.deepEqual((await import('./index.js')).inject, ['tools', 'webServer'], 'llm must not be a hard dependency')
    assert.ok(serverSource.includes("ctx.inject(['llm']"), 'verdict may use an optional llm service')
  })

  it('should define vision_bridge_read_image tool', () => {
    assert.ok(serverSource.includes('vision_bridge_read_image'))
  })

  it('should register all web routes', () => {
    assert.ok(serverSource.includes('/vision-bridge/paste'))
    assert.ok(serverSource.includes('/vision-bridge/verdict'))
    assert.ok(serverSource.includes('/vision-bridge/config'))
    assert.ok(serverSource.includes('/vision-bridge/test'))
  })

  it('should not write plugin diagnostics to the DSH startup console', () => {
    assert.doesNotMatch(serverSource, /console\.(?:log|error|warn|info|debug)/)
    assert.doesNotMatch(clientSource, /console\.(?:log|error|warn|info|debug)/)
    assert.ok(!serverSource.includes('[dsh-vision-bridge]'))
    assert.ok(!clientSource.includes('[dsh-vision-bridge]'))
  })

  it('should include common HEIC brands', () => {
    assert.ok(serverSource.includes("'heic'"))
    assert.ok(serverSource.includes("'heix'"))
    assert.ok(serverSource.includes("'mif1'"))
  })

  it('should use convention-compliant settings namespace', () => {
    assert.ok(serverSource.includes("const SETTINGS_NAMESPACE = 'vision-bridge'"))
    // 命名空间必须匹配宿主 NAMESPACE_PATTERN(/^[a-z][a-z0-9-]*$/)
    assert.match('vision-bridge', /^[a-z][a-z0-9-]*$/)
  })

  it('should register namespace via settings service with hot reload', () => {
    assert.ok(serverSource.includes("sctx.settings.register(SETTINGS_NAMESPACE"))
    assert.ok(serverSource.includes('scope.watch('))
  })

  it('should resolve apiKey through the DSH credentials service', () => {
    // 与 DSH 模型配置/凭据页同一密钥渠道（ctx.credentials.resolve），
    // 直接读 env 仅为 credentials 服务不可用时的兜底
    assert.ok(serverSource.includes("ctx.inject(['credentials']"))
    assert.ok(serverSource.includes('credentials.resolve'))
    assert.ok(serverSource.includes("keySource: 'credentials'"))
    assert.ok(serverSource.includes('credentials/reference-updated'))
    assert.ok(serverSource.includes('const envValue = process.env[config.apiKeyEnv]'))
    assert.ok(serverSource.includes("keySource: 'env'"))
  })

  it('should call registered DSH providers through llm and attachments', () => {
    assert.ok(serverSource.includes("ctx.inject(['attachments']"))
    assert.ok(serverSource.includes('state.attachments.saveImage'))
    assert.ok(serverSource.includes('state.llm.stream'))
    assert.ok(serverSource.includes("type: 'image'"))
    assert.ok(serverSource.includes("providerMode === 'dsh'"))
  })

  it('should never echo apiKey in sanitized view', () => {
    // sanitizedView 只返回 keySource/keyResolved 布尔,不含密钥原文
    const view = /function sanitizedView[\s\S]{0,600}/.exec(serverSource)[0]
    assert.ok(!view.includes('apiKey:'), 'sanitized view must not include apiKey field')
  })

  it('should enforce same-origin fence on mutating routes', () => {
    assert.ok(serverSource.includes('function sameOrigin'))
    const pasteRoute = /function registerPasteRoute[\s\S]*?function registerVerdictRoute/.exec(serverSource)?.[0] ?? ''
    const originFence = pasteRoute.indexOf('if (!sameOrigin(req))')
    const bodyRead = pasteRoute.indexOf('for await (const chunk of req)')
    assert.ok(originFence >= 0)
    assert.ok(bodyRead > originFence, 'same-origin fence must run before consuming the upload body')
    assert.ok(pasteRoute.includes('跨站请求被拒绝'))
  })

  it('should not confuse same-name models across providers', () => {
    const catalogs = [
      { providerId: 'text-provider', models: [{ id: 'shared-model', inputModalities: ['text'] }] },
      { providerId: 'vision-provider', models: [{ id: 'shared-model', inputModalities: ['text', 'image'] }] },
    ]
    assert.equal(plugin.decidePasteTakeover('text-provider / shared-model', catalogs), true)
    assert.equal(plugin.decidePasteTakeover('vision-provider / shared-model', catalogs), false)
    assert.equal(plugin.decidePasteTakeover('shared-model', catalogs), false)

    const overlappingProviders = [
      { providerId: 'openai', models: [{ id: 'shared-model', inputModalities: ['text', 'image'] }] },
      { providerId: 'my-openai', models: [{ id: 'shared-model', inputModalities: ['text'] }] },
    ]
    assert.equal(plugin.decidePasteTakeover('my-openai / shared-model', overlappingProviders), true)
  })

  it('should reject bridge operations while disabled', () => {
    assert.match(serverSource, /vision bridge 已停用/)
    assert.match(serverSource, /视觉桥接已停用/)
    assert.match(serverSource, /if \(!state\.config\?\.enabled\)/)
  })

  it('should read settings back after saving before responding', () => {
    assert.match(serverSource, /await face\.service\.update\(SETTINGS_NAMESPACE, clean, body\.revision\)/)
    assert.match(serverSource, /state\.refreshConfig = refreshConfig/)
    assert.match(serverSource, /await state\.refreshConfig\(state\.settingsScope\.get\(\), 'settings 服务（保存后回读）'\)/)
    assert.doesNotMatch(serverSource, /await refreshConfig\(state\.settingsScope/)
  })

  it('should migrate legacy direct-provider settings without an explicit mode', () => {
    assert.match(serverSource, /Object\.hasOwn\(section, 'providerMode'\)/)
    assert.match(serverSource, /declaredMode === 'dsh' \|\| declaredMode === 'custom'/)
    assert.match(serverSource, /hasLegacyCustomFields \? 'custom' : 'dsh'/)
  })

  it('should support explicitly clearing a stored custom API key', () => {
    assert.ok(serverSource.includes("'clearApiKey'"))
    assert.match(serverSource, /patch\.clearApiKey === true\) clean\.apiKey = ''/)
  })
})

describe('dsh-vision-bridge client', () => {
  it('should load via ModuleLoader with correct id', () => {
    assert.ok(clientSource.includes('__ModuleLoader__'))
    assert.ok(clientSource.includes('dsh-vision-bridge/client'))
  })

  it('should keep paste interception', () => {
    assert.ok(clientSource.includes('handlePaste'))
    assert.ok(clientSource.includes('clipboardData'))
    assert.ok(clientSource.includes('/vision-bridge/paste'))
    assert.ok(clientSource.includes('/vision-bridge/verdict'))
  })

  it('should render intercepted images as compact non-Markdown references', () => {
    assert.ok(clientSource.includes('function attachmentReference(id)'))
    assert.ok(clientSource.includes('return `「▧ 图片 #${id}」`'))
    assert.ok(clientSource.includes('attachmentReference(id)'))
    assert.ok(clientSource.includes('上传服务版本不一致，请完整重启 DSH'))
    assert.ok(clientSource.includes('/paste-([A-Za-z0-9_-]{6,32})'))
    assert.ok(serverSource.includes("const PASTE_REFERENCE_SCHEME = 'vision:'"))
    assert.ok(serverSource.includes("sendJson(res, 200, { id: imageId })"))
    assert.ok(serverSource.includes("path.slice(`${PASTE_REFERENCE_SCHEME}//`.length)"))
    assert.ok(serverSource.includes('“「▧ 图片 #ID」”, read vision://ID'))
    assert.ok(serverSource.includes("无效的视觉附件 ID"))
    assert.ok(!serverSource.includes('latestPastePath'))
    assert.ok(!serverSource.includes('vision://latest'))
    assert.ok(!clientSource.includes('attachmentMarkdown'))
    assert.ok(!clientSource.includes('`[图片附件] 路径：${path}`'))
  })

  it('should register inside the plugin settings page', () => {
    assert.ok(clientSource.includes("slots.inject('settings.plugin.item'"))
    assert.ok(clientSource.includes("name: 'settings.plugin.item'"))
    assert.ok(clientSource.includes("key: 'vision-bridge'"))
    assert.ok(!clientSource.includes("slots.inject('settings.section'"))
  })

  it('should render as a collapsible plugin submenu instead of a bare form', () => {
    assert.ok(clientSource.includes("const [open, setOpen] = useState(false)"))
    assert.ok(clientSource.includes("className: 'vb-cardHeader'"))
    assert.ok(clientSource.includes("'aria-expanded': open"))
    assert.ok(clientSource.includes("open ? el('div', { className: 'vb-cardBody' }, body) : null"))
    assert.ok(clientSource.includes('为纯文本模型桥接 DSH 视觉 Provider'))
  })

  it('should expose cordis client face (apply/inject)', () => {
    assert.ok(clientSource.includes('exports.apply = apply'))
    assert.ok(clientSource.includes('exports.inject = inject'))
    assert.ok(clientSource.includes("['slots']"))
  })

  it('should talk to config and test routes', () => {
    assert.ok(clientSource.includes('/vision-bridge/config'))
    assert.ok(clientSource.includes('/vision-bridge/test'))
  })

  it('should render field controls passed as function arguments', () => {
    assert.match(clientSource, /function Field\(props\)[\s\S]*Array\.prototype\.slice\.call\(arguments, 1\)/)
    assert.match(clientSource, /el\('div', \{ className: 'vb-control' \}, \.\.\.content\)/)
    assert.match(clientSource, /className: 'vb-field'/)
  })

  it('should never cancel image paste while the bridge is disabled or unknown', () => {
    assert.match(clientSource, /if \(!pasteConfigReady \|\| !pasteEnabled\) return/)
    assert.match(clientSource, /if \(cached !== true\)[\s\S]*void shouldTakeover\(label\)[\s\S]*return/)
    assert.match(clientSource, /setPasteEnabled\(data\.config\?\.enabled\)/)
  })

  it('should prefetch a verdict when the selected model changes', () => {
    assert.match(clientSource, /function observeModelSelection\(\)[\s\S]*MutationObserver/)
    assert.match(clientSource, /observer\.observe\(document\.documentElement/)
    assert.match(clientSource, /prefetchCurrentVerdict\(\)/)
    assert.match(clientSource, /const verdictRequests = new Map\(\)/)
  })

  it('should present DSH providers and an explicit custom-provider path', () => {
    assert.ok(clientSource.includes('status?.dshProviders'))
    assert.ok(clientSource.includes('请选择已添加的 Provider'))
    assert.ok(clientSource.includes('新增 Provider'))
    assert.ok(clientSource.includes("providerMode: 'custom'"))
    assert.ok(clientSource.includes('不会注册到 DSH 全局 Provider 列表'))
  })

  it('should not inherit an old endpoint or credential when adding a provider', () => {
    const customFlow = /const useCustomProvider[\s\S]{0,600}/.exec(clientSource)?.[0] ?? ''
    assert.ok(customFlow.includes("baseUrl: ''"))
    assert.ok(customFlow.includes("apiKeyEnv: ''"))
    assert.ok(customFlow.includes('setClearApiKey(true)'))
    assert.ok(clientSource.includes('patch.clearApiKey = true'))
  })
})

describe('package declaration', () => {
  it('should declare client bundle for the web platform', () => {
    assert.equal(pkg.dsh.client?.platform, 'web')
    assert.equal(pkg.exports['./client'], './dsh/client.js')
  })

  it('should declare bundle patch', () => {
    assert.equal(pkg.dsh.bundle?.patch, './dsh/cordis.patch.yml')
  })

  it('should include dsh dir in published files', () => {
    assert.ok(pkg.files.includes('dsh/'))
  })
})
