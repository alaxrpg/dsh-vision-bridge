import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const serverSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('dsh-vision-bridge server', () => {
  it('should be importable and export plugin face', async () => {
    const mod = await import('./index.js')
    assert.ok(mod.apply, 'apply function should exist')
    assert.equal(mod.name, 'dsh-vision-bridge')
    assert.deepEqual(mod.inject, ['tools', 'llm', 'webServer'])
  })

  it('should have all provider presets', () => {
    assert.ok(serverSource.includes('sensennova'), 'should have sensennova preset')
    assert.ok(serverSource.includes('openai'), 'should have openai preset')
    assert.ok(serverSource.includes('gemini'), 'should have gemini preset')
    assert.ok(serverSource.includes('ollama'), 'should have ollama preset')
  })

  it('should have correct text-only families', () => {
    assert.ok(serverSource.includes("'deepseek'"), 'should include deepseek')
    assert.ok(serverSource.includes("'glm'"), 'should include glm')
    assert.ok(serverSource.includes("'qwen'"), 'should include qwen')
    assert.ok(serverSource.includes("'mimo'"), 'should include mimo')
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

  it('should never echo apiKey in sanitized view', () => {
    // sanitizedView 只返回 keySource/keyResolved 布尔,不含密钥原文
    const view = /function sanitizedView[\s\S]{0,600}/.exec(serverSource)[0]
    assert.ok(!view.includes('apiKey:'), 'sanitized view must not include apiKey field')
  })

  it('should enforce same-origin fence on mutating routes', () => {
    assert.ok(serverSource.includes('function sameOrigin'))
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

  it('should register a settings section', () => {
    assert.ok(clientSource.includes("slots.inject('settings.section'"))
    assert.ok(clientSource.includes("id: 'vision-bridge'"))
    assert.ok(clientSource.includes('视觉桥接'))
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
})

describe('package declaration', () => {
  it('should declare client bundle for the web platform', () => {
    assert.equal(pkg.dsh.client?.platform, 'web')
    assert.equal(pkg.exports['./client'], './dsh/client.js')
  })

  it('should declare bundle patch', () => {
    assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml')
  })

  it('should include dsh dir in published files', () => {
    assert.ok(pkg.files.includes('dsh/'))
  })
})
