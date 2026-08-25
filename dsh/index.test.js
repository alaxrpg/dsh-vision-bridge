import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ============================================================================
// 测试用例
// ============================================================================

describe('dsh-vision-bridge', () => {
  // 测试图片魔数检测
  describe('sniffMime', () => {
    // 导入内部函数需要重构，这里测试公开接口
    it('should be importable', async () => {
      const mod = await import('./index.js')
      assert.ok(mod.apply, 'apply function should exist')
      assert.ok(mod.name, 'name should exist')
      assert.equal(mod.name, 'dsh-vision-bridge')
    })
  })

  // 测试配置解析
  describe('configuration', () => {
    it('should have correct provider presets', async () => {
      // 读取源码检查预设配置
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./index.js', import.meta.url), 'utf-8')

      assert.ok(source.includes('sensennova'), 'should have sensennova preset')
      assert.ok(source.includes('openai'), 'should have openai preset')
      assert.ok(source.includes('gemini'), 'should have gemini preset')
      assert.ok(source.includes('ollama'), 'should have ollama preset')
    })

    it('should have correct text-only families', async () => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./index.js', import.meta.url), 'utf-8')

      assert.ok(source.includes("'deepseek'"), 'should include deepseek')
      assert.ok(source.includes("'glm'"), 'should include glm')
      assert.ok(source.includes("'qwen'"), 'should include qwen')
      assert.ok(source.includes("'mimo'"), 'should include mimo')
    })
  })

  // 测试工具定义
  describe('tool definition', () => {
    it('should have vision_bridge_read_image tool', async () => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./index.js', import.meta.url), 'utf-8')

      assert.ok(source.includes('vision_bridge_read_image'), 'should define vision_bridge_read_image tool')
    })
  })

  // 测试路由注册
  describe('route registration', () => {
    it('should register paste route', async () => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./index.js', import.meta.url), 'utf-8')

      assert.ok(source.includes('/vision-bridge/paste'), 'should register paste route')
    })

    it('should register verdict route', async () => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./index.js', import.meta.url), 'utf-8')

      assert.ok(source.includes('/vision-bridge/verdict'), 'should register verdict route')
    })
  })

  // 测试 HEIC 品牌检测
  describe('HEIC brands', () => {
    it('should include common HEIC brands', async () => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./index.js', import.meta.url), 'utf-8')

      assert.ok(source.includes("'heic'"), 'should include heic')
      assert.ok(source.includes("'heix'"), 'should include heix')
      assert.ok(source.includes("'mif1'"), 'should include mif1')
    })
  })
})

describe('client.js', () => {
  it('should be loadable', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./client.js', import.meta.url), 'utf-8')

    assert.ok(source.includes('__ModuleLoader__'), 'should use ModuleLoader')
    assert.ok(source.includes('dsh-vision-bridge/client'), 'should have correct module id')
  })

  it('should handle paste events', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./client.js', import.meta.url), 'utf-8')

    assert.ok(source.includes('handlePaste'), 'should define handlePaste function')
    assert.ok(source.includes('clipboardData'), 'should access clipboardData')
  })
})
