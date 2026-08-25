// dsh-vision-bridge 浏览器端 bundle（经 __ModuleLoader__ 加载，classic script）
//
// 两部分职责：
//  1. 粘贴拦截：当前模型不支持图片时，把粘贴的图片上传到服务端并插入路径文本；
//  2. 设置页「视觉桥接」分节：可视化编辑 provider/model/key/timeout，
//     保存即热生效（服务端 settings 服务），并提供连通性测试按钮。
//
// 数据通道全部走本插件自己的 web 路由（/vision-bridge/*），不依赖 Typert。

window.__ModuleLoader__.load({
  id: 'dsh-vision-bridge/client',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState, useEffect, useCallback, useMemo } = React
    const el = React.createElement
    const Fragment = React.Fragment

    const CONFIG_ROUTE = '/vision-bridge/config'
    const TEST_ROUTE = '/vision-bridge/test'
    const PASTE_ROUTE = '/vision-bridge/paste'
    const VERDICT_ROUTE = '/vision-bridge/verdict'
    const VERDICT_MAX_AGE_MS = 60000

    // ─────────────────────────────────────────────────────────────────────
    // 样式（--dsw-* 主题变量，跟随全局亮/暗主题）
    // ─────────────────────────────────────────────────────────────────────

    const STYLE_ID = 'dsh-vision-bridge-style'

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '/* dsh-vision-bridge 设置分节 */',
        '.vb-section{display:flex;flex-direction:column;gap:18px;padding:4px 2px 24px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:760px;width:100%}',
        '.vb-intro{color:var(--dsw-alias-label-tertiary);margin:0;padding:0 2px;font-size:13px;line-height:20px}',
        '.vb-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 2px}',
        '.vb-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:22px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
        '.vb-chip.ok{color:var(--dsw-alias-state-ok-primary,#3ba272)}',
        '.vb-chip.bad{color:var(--dsw-alias-state-error-primary)}',
        '.vb-group{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:16px;flex-direction:column;gap:12px;padding:18px 20px;display:flex}',
        '.vb-row{display:flex;align-items:center;gap:12px;min-width:0}',
        '.vb-row.col{flex-direction:column;align-items:stretch;gap:6px}',
        '.vb-label{flex:none;width:110px;color:var(--dsw-alias-label-secondary);font-size:13px}',
        '.vb-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:5px 10px;font-size:13px;line-height:20px}',
        '.vb-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
        '.vb-input.short{width:90px;flex:none}',
        '.vb-select{cursor:pointer;max-width:320px}',
        '.vb-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
        '.vb-mono{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-secondary)}',
        '.vb-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.vb-btn{appearance:none;font:inherit;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
        '.vb-btn:hover{background:var(--dsw-alias-interactive-bg-hover-accent,var(--dsw-alias-label-primary))}',
        '.vb-btn:disabled{opacity:.5;cursor:default}',
        '.vb-btn.ghost{background:transparent;color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}',
        '.vb-btn.ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.vb-msg{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
        '.vb-msg.ok{color:var(--dsw-alias-state-ok-primary,#3ba272)}',
        '.vb-msg.bad{color:var(--dsw-alias-state-error-primary)}',
        '.vb-switch{cursor:pointer;flex:none;display:inline-flex;position:relative}',
        '.vb-switchInput{opacity:0;width:1px;height:1px;margin:0;position:absolute}',
        '.vb-switchTrack{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;align-items:center;width:36px;height:20px;padding:2px;transition:background .15s,border-color .15s;display:inline-flex}',
        '.vb-switchThumb{background:var(--dsw-alias-label-tertiary);border-radius:50%;width:14px;height:14px;transition:transform .15s,background .15s;display:block}',
        '.vb-switch:hover .vb-switchTrack{border-color:var(--dsw-alias-label-dimmed)}',
        '.vb-switchInput:checked+.vb-switchTrack{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill)}',
        '.vb-switchInput:checked+.vb-switchTrack .vb-switchThumb{background:var(--dsw-alias-bg-layer-3);transform:translateX(16px)}',
        '.vb-switchInput:focus-visible+.vb-switchTrack{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      ].join('\n')
      document.head.appendChild(style)
    }

    // ─────────────────────────────────────────────────────────────────────
    // 第一部分：粘贴拦截（立即生效，不依赖插件 ctx）
    // ─────────────────────────────────────────────────────────────────────

    // 图片文件检测
    function imageFilesOf(event) {
      const items = event.clipboardData?.items
      if (!items) return []
      const files = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file && /^image\//.test(file.type)) files.push(file)
      }
      return files
    }

    // 插入文本到输入框
    function insertText(target, text) {
      const el0 = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
        ? target
        : document.activeElement
      if (!el0 || (el0.tagName !== 'TEXTAREA' && el0.tagName !== 'INPUT')) return

      el0.focus()
      let inserted = false
      try {
        inserted = document.execCommand('insertText', false, text)
      } catch {
        inserted = false
      }
      if (!inserted) {
        const proto = el0.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el0, el0.value + text)
        el0.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }

    // 上传图片到服务端
    async function uploadImage(file) {
      const buffer = await file.arrayBuffer()
      const response = await fetch(PASTE_ROUTE, {
        method: 'POST',
        body: buffer,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Upload failed (${response.status})`)
      }
      return response.json()
    }

    // 获取当前模型标签
    function currentModelLabel() {
      const buttons = document.querySelectorAll('button[aria-label]')
      for (const button of buttons) {
        const label = button.getAttribute('aria-label') || ''
        if (/选择模型|select model|current model/i.test(label)) return label
      }
      return ''
    }

    // 判断是否需要接管粘贴（模型不支持图片时），带 60s 缓存
    const verdicts = new Map()

    async function shouldTakeover(label) {
      if (!label) return false

      const cached = verdicts.get(label)
      if (cached && Date.now() - cached.at < VERDICT_MAX_AGE_MS) {
        return cached.takeover
      }

      try {
        const response = await fetch(`${VERDICT_ROUTE}?model=${encodeURIComponent(label)}`)
        if (!response.ok) return false
        const { takeover } = await response.json()
        verdicts.set(label, { takeover, at: Date.now() })
        return takeover
      } catch {
        return false
      }
    }

    // 粘贴事件处理
    async function handlePaste(event) {
      const files = imageFilesOf(event)
      if (files.length === 0) return

      const label = currentModelLabel()
      const takeover = await shouldTakeover(label)
      if (!takeover) return

      // 阻止默认粘贴行为
      event.preventDefault()
      event.stopPropagation()

      // 上传每张图片
      for (const file of files) {
        try {
          const { path } = await uploadImage(file)
          const text = `[图片附件] 路径：${path}`
          insertText(event.target, text)
        } catch (error) {
          console.error('[dsh-vision-bridge] 图片上传失败:', error)
          insertText(event.target, `[图片上传失败: ${error.message}]`)
        }
      }
    }

    // 注册粘贴监听（捕获阶段，优先于其他处理器）
    document.addEventListener('paste', handlePaste, { capture: true })

    // ─────────────────────────────────────────────────────────────────────
    // 第二部分：设置页「视觉桥接」分节
    // ─────────────────────────────────────────────────────────────────────

    // 服务端 API 封装
    const api = {
      load: async () => {
        const response = await fetch(CONFIG_ROUTE)
        if (!response.ok) throw new Error(`加载配置失败 (HTTP ${response.status})`)
        return response.json()
      },
      save: async (patch, revision) => {
        const response = await fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch, revision }),
        })
        const data = await response.json().catch(() => ({}))
        if (response.status === 409) {
          const error = new Error(data.error || '配置冲突')
          error.conflict = true
          throw error
        }
        if (!response.ok) throw new Error(data.error || `保存失败 (HTTP ${response.status})`)
        return data
      },
      test: async () => {
        const response = await fetch(TEST_ROUTE, { method: 'POST' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `测试失败 (HTTP ${response.status})`)
        return data
      },
    }

    // 字段行：label + 控件
    function Field(props) {
      return el('div', { className: 'vb-row' },
        el('div', { className: 'vb-label' }, props.label),
        props.children)
    }

    // 主分节组件
    function VisionBridgeSection() {
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState(null)
      const [draft, setDraft] = useState(null)     // 编辑中的表单
      const [saved, setSaved] = useState(null)     // 服务端已保存的 config
      const [status, setStatus] = useState(null)   // 服务端 status（presets 等）
      const [revision, setRevision] = useState(undefined)
      const [saving, setSaving] = useState(false)
      const [testing, setTesting] = useState(false)
      const [message, setMessage] = useState(null)   // { kind: 'ok'|'bad'|'info', text }
      const [testResult, setTestResult] = useState(null)
      const [apiKeyInput, setApiKeyInput] = useState('')

      useEffect(() => {
        ensureStyle()
        let alive = true
        api.load()
          .then((data) => {
            if (!alive) return
            setSaved(data.config)
            setStatus(data.status)
            setRevision(data.revision)
            setDraft({
              enabled: data.config.enabled,
              provider: data.config.provider,
              baseUrl: data.config.baseUrl,
              model: data.config.model,
              apiKeyEnv: data.config.apiKeyEnv,
              timeout: String(data.config.timeout),
            })
            setLoading(false)
          })
          .catch((error) => {
            if (!alive) return
            setLoadError(error.message)
            setLoading(false)
          })
        return () => { alive = false }
      }, [])

      const setField = useCallback((key, value) => {
        setDraft((prev) => ({ ...prev, [key]: value }))
      }, [])

      const presets = status?.presets ?? {}
      const presetIds = useMemo(
        () => Object.keys(presets).filter((id) => id !== 'custom'),
        [status],
      )
      const isPreset = draft?.provider != null && presets[draft.provider] !== undefined

      // 切换预设：baseUrl/model/apiKeyEnv 跟随预设缺省
      const onProviderChange = useCallback((next) => {
        setDraft((prev) => {
          if (next === 'custom') return { ...prev, provider: 'custom' }
          const preset = presets[next]
          if (!preset) return { ...prev, provider: next }
          return {
            ...prev,
            provider: next,
            baseUrl: preset.baseUrl,
            model: preset.model,
            apiKeyEnv: preset.apiKeyEnv,
          }
        })
      }, [presets])

      const dirty = useMemo(() => {
        if (!draft || !saved) return false
        return draft.enabled !== saved.enabled
          || draft.provider !== saved.provider
          || draft.baseUrl !== saved.baseUrl
          || draft.model !== saved.model
          || draft.apiKeyEnv !== saved.apiKeyEnv
          || Number(draft.timeout) !== saved.timeout
          || apiKeyInput !== ''
      }, [draft, saved, apiKeyInput])

      const doSave = useCallback(async () => {
        if (saving) return
        setSaving(true)
        setMessage(null)
        try {
          const patch = {
            enabled: draft.enabled,
            provider: draft.provider,
            baseUrl: draft.baseUrl.trim(),
            model: draft.model.trim(),
            apiKeyEnv: draft.apiKeyEnv.trim(),
            timeout: Number(draft.timeout) || 90,
          }
          if (apiKeyInput.trim() !== '') patch.apiKey = apiKeyInput.trim()
          const data = await api.save(patch, revision)
          setSaved(data.config)
          setStatus(data.status)
          setRevision(data.revision)
          setApiKeyInput('')
          setMessage({ kind: 'ok', text: data.message || '已保存' })
        } catch (error) {
          if (error.conflict) {
            setMessage({ kind: 'bad', text: `${error.message}（点击「重新加载」后重试）` })
          } else {
            setMessage({ kind: 'bad', text: error.message })
          }
        } finally {
          setSaving(false)
        }
      }, [draft, apiKeyInput, revision, saving])

      const doReload = useCallback(async () => {
        setMessage(null)
        setTestResult(null)
        try {
          const data = await api.load()
          setSaved(data.config)
          setStatus(data.status)
          setRevision(data.revision)
          setDraft({
            enabled: data.config.enabled,
            provider: data.config.provider,
            baseUrl: data.config.baseUrl,
            model: data.config.model,
            apiKeyEnv: data.config.apiKeyEnv,
            timeout: String(data.config.timeout),
          })
          setApiKeyInput('')
        } catch (error) {
          setMessage({ kind: 'bad', text: error.message })
        }
      }, [])

      const doTest = useCallback(async () => {
        if (testing) return
        setTesting(true)
        setTestResult(null)
        try {
          const data = await api.test()
          setTestResult(data)
        } catch (error) {
          setTestResult({ ok: false, error: error.message })
        } finally {
          setTesting(false)
        }
      }, [testing])

      if (loading) {
        return el('div', { className: 'vb-section' }, el('p', { className: 'vb-note' }, '正在加载配置…'))
      }

      if (loadError !== null) {
        return el('div', { className: 'vb-section' },
          el('p', { className: 'vb-msg bad' }, `配置加载失败：${loadError}`),
          el('div', { className: 'vb-buttons' },
            el('button', { className: 'vb-btn ghost', onClick: doReload }, '重新加载')))
      }

      if (draft === null || saved === null) {
        return el('div', { className: 'vb-section' }, el('p', { className: 'vb-note' }, '暂无配置'))
      }

      const keyChip = saved.keyResolved
        ? el('span', {
            className: 'vb-chip ok',
            title: saved.keySource === 'env' ? `从环境变量 ${saved.apiKeyEnv} 解析` : '存储于 settings.yaml',
          }, `● API Key 已就绪（${saved.keySource === 'env' ? saved.apiKeyEnv : 'settings'}）`)
        : el('span', { className: 'vb-chip bad' }, '● API Key 缺失')

      const enabledSwitch = el('div', { className: 'vb-row' },
        el('div', { className: 'vb-label' }, '启用桥接'),
        el('label', { className: 'vb-switch' },
          el('input', {
            className: 'vb-switchInput',
            type: 'checkbox',
            checked: draft.enabled,
            onChange: (e) => setField('enabled', e.target.checked),
          }),
          el('span', { className: 'vb-switchTrack' },
            el('span', { className: 'vb-switchThumb' }))),
        el('span', { className: 'vb-note' },
          '停用后不再接管图片粘贴，也不暴露 (vision bridge) 模型'))

      const providerSelect = el('select', {
        className: 'vb-input vb-select',
        value: draft.provider,
        onChange: (e) => onProviderChange(e.target.value),
      },
        presetIds.map((id) => el('option', { key: id, value: id }, presets[id].label ?? id)),
        el('option', { value: 'custom' }, '自定义（OpenAI 兼容）'))

      const providerRow = Field({ label: 'Provider' },
        providerSelect,
        !isPreset && draft.provider !== 'custom'
          ? el('span', { className: 'vb-mono' }, draft.provider)
          : null)

      const baseUrlRow = Field({ label: 'Base URL' },
        el('input', {
          className: 'vb-input',
          type: 'text',
          value: draft.baseUrl,
          placeholder: 'https://.../v1',
          onChange: (e) => setField('baseUrl', e.target.value),
        }))

      const modelRow = Field({ label: '视觉模型' },
        el('input', {
          className: 'vb-input',
          type: 'text',
          value: draft.model,
          placeholder: 'sensenova-u1-fast',
          onChange: (e) => setField('model', e.target.value),
        }))

      const apiKeyEnvRow = Field({ label: 'Key 环境变量' },
        el('input', {
          className: 'vb-input',
          type: 'text',
          value: draft.apiKeyEnv,
          placeholder: 'SENSENNOVA_API_KEY',
          onChange: (e) => setField('apiKeyEnv', e.target.value),
        }),
        el('p', { className: 'vb-note' },
          '启动 DSH 的 shell 中 export 该变量即可被读取；或直接在下方填入 Key（存入 settings.yaml）'))

      const apiKeyRow = Field({ label: 'API Key' },
        el('input', {
          className: 'vb-input',
          type: 'password',
          value: apiKeyInput,
          placeholder: saved.keyResolved ? '已配置（留空保持不变）' : '未配置，可在此填入',
          onChange: (e) => setApiKeyInput(e.target.value),
          autoComplete: 'new-password',
        }))

      const timeoutRow = Field({ label: '超时（秒）' },
        el('input', {
          className: 'vb-input short',
          type: 'number',
          min: 5,
          max: 600,
          value: draft.timeout,
          onChange: (e) => setField('timeout', e.target.value),
        }),
        el('span', { className: 'vb-note' }, '识别单张图片的 API 超时，5–600'))

      const buttonsRow = el('div', { className: 'vb-buttons' },
        el('button', { className: 'vb-btn', onClick: doSave, disabled: saving || !dirty },
          saving ? '保存中…' : '保存'),
        el('button', { className: 'vb-btn ghost', onClick: doReload, disabled: saving }, '重新加载'),
        el('button', { className: 'vb-btn ghost', onClick: doTest, disabled: testing },
          testing ? '测试中…' : '测试连通性'),
        dirty && !saving ? el('span', { className: 'vb-msg' }, '有未保存的修改') : null,
        message ? el('span', { className: `vb-msg ${message.kind}` }, message.text) : null)

      const testLine = testResult === null ? null
        : el('p', { className: testResult.ok ? 'vb-msg ok' : 'vb-msg bad' },
            testResult.ok
              ? `✓ 连通正常：${testResult.provider}/${testResult.model} · ${testResult.latencyMs}ms`
                + (testResult.sample ? ` · 响应「${testResult.sample}」` : '')
              : `✗ 测试失败：${testResult.error || '未知错误'}（${testResult.latencyMs ?? '?'}ms）`)

      const noteLine = el('p', { className: 'vb-note' },
        '保存后立即热生效（无需重启）。配置存储于 settings.yaml 的 ',
        el('span', { className: 'vb-mono' }, status?.namespace ?? 'vision-bridge'),
        ' 段；API Key 永远不会回显到浏览器。')

      const chipsRow = el('div', { className: 'vb-chips' },
        el('span', { className: `vb-chip ${saved.enabled ? 'ok' : 'bad'}` },
          saved.enabled ? '● 已启用' : '● 已停用'),
        keyChip,
        status?.providerRegistered
          ? el('span', { className: 'vb-chip ok' }, '● 桥接 Provider 已注册')
          : el('span', { className: 'vb-chip' }, '○ 桥接 Provider 未注册'),
        status?.settingsService
          ? el('span', { className: 'vb-chip ok' }, '● 设置服务已连接')
          : el('span', { className: 'vb-chip bad' }, '● 设置服务不可用（只读模式）'),
        el('span', { className: 'vb-chip' },
          el('span', { className: 'vb-mono' }, `${saved.provider} · ${saved.model}`)))

      const formGroup = el('div', { className: 'vb-group' },
        enabledSwitch,
        providerRow,
        baseUrlRow,
        modelRow,
        apiKeyEnvRow,
        apiKeyRow,
        timeoutRow,
        buttonsRow,
        testLine,
        noteLine)

      const intro = el('p', { className: 'vb-intro' },
        '为纯文本模型（DeepSeek / GLM / Qwen / MiMo 等）桥接视觉能力：粘贴图片或调用 ',
        el('span', { className: 'vb-mono' }, 'vision_bridge_read_image'),
        ' 工具时，先由下方多模态模型识别为结构化文本证据，再交给当前模型。')

      return el('div', { className: 'vb-section' },
        intro,
        chipsRow,
        formGroup)
    }

    // ─────────────────────────────────────────────────────────────────────
    // 插件装配
    // ─────────────────────────────────────────────────────────────────────

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.slots ?? (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
      if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        return
      }

      ensureStyle()

      slots.inject('settings.section', () => {
        const dispose = slots.register({
          name: 'settings.section',
          id: 'vision-bridge',
          order: 22,
          label: '视觉桥接',
          inject: () => ({ api }),
        }, VisionBridgeSection)
        return () => dispose()
      })

      console.log('[dsh-vision-bridge] 浏览器端已加载（粘贴拦截 + 设置分节）')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
