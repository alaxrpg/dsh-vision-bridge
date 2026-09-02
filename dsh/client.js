// dsh-vision-bridge 浏览器端 bundle（经 __ModuleLoader__ 加载，classic script）
//
// 两部分职责：
//  1. 粘贴拦截：当前模型不支持图片时，把粘贴的图片上传到服务端并插入路径文本；
//  2. 设置页「插件」中的「视觉桥接」可折叠子菜单：可视化编辑 provider/model/key/timeout，
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
        '/* dsh-vision-bridge 插件配置子菜单 */',
        '.vb-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s;overflow:hidden}',
        '.vb-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
        '.vb-card.open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
        '.vb-cardHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;align-items:center;gap:12px;padding:14px 16px;display:flex}',
        '.vb-cardHeader:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
        '.vb-cardHeadText{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}',
        '.vb-cardTitle{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
        '.vb-cardSubtitle{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
        '.vb-cardPending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}',
        '.vb-cardChevron{color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:1;transition:transform .16s;transform:rotate(0deg)}',
        '.vb-card.open .vb-cardChevron{transform:rotate(180deg)}',
        '.vb-cardBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:14px 0 16px}',
        '.vb-section{display:flex;flex-direction:column;gap:18px;font-size:13px;color:var(--dsw-alias-label-primary);width:100%}',
        '.vb-intro{color:var(--dsw-alias-label-tertiary);margin:0;padding:0 2px;font-size:13px;line-height:20px}',
        '.vb-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 2px}',
        '.vb-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:22px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
        '.vb-chip.ok{color:var(--dsw-alias-state-ok-primary,#3ba272)}',
        '.vb-chip.bad{color:var(--dsw-alias-state-error-primary)}',
        '.vb-group{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:16px;flex-direction:column;gap:12px;padding:18px 20px;display:flex}',
        '.vb-row{display:flex;align-items:center;gap:12px;min-width:0}',
        '.vb-row.col{flex-direction:column;align-items:stretch;gap:6px}',
        '.vb-label{flex:none;width:110px;color:var(--dsw-alias-label-secondary);font-size:13px}',
        '.vb-field{display:grid;grid-template-columns:minmax(118px,150px) minmax(0,1fr);align-items:start;gap:12px;min-width:0}',
        '.vb-field>.vb-label{width:auto;padding-top:6px;font-weight:500}',
        '.vb-control{display:flex;flex-direction:column;gap:6px;min-width:0}',
        '.vb-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;padding:5px 10px;font-size:13px;line-height:20px}',
        '.vb-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
        '.vb-input.short{width:90px;flex:none}',
        '.vb-select{cursor:pointer;max-width:320px}',
        '.vb-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
        '.vb-mono{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-secondary)}',
        '.vb-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.vb-btn{appearance:none;font:inherit;cursor:pointer;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-3));border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
        // 实心主按钮 hover 用宿主实色 button-primary-hover；interactive-bg-hover-accent 是
        // 半透明叠加层（亮色 #ffffff3d），直接当背景会把深色按钮整体“洗白”。
        '.vb-btn:not(:disabled):hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-label-primary))}',
        '.vb-btn:disabled{opacity:.5;cursor:default}',
        '.vb-btn.ghost{background:transparent;color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}',
        '.vb-btn.ghost:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
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

    // 插入文本到输入框，返回是否确认插入成功（Promise）
    // 目标解析：显式传入 TEXTAREA/INPUT 则用之，否则取当前焦点元素。
    // DSH 0.1.2-alpha 起输入框是 Lexical 受控 contenteditable（activeElement
    // 是 div 而非表单控件），guard 不能只认 TEXTAREA/INPUT。contenteditable
    // 分支按「串行尝试 + 异步确认」框架走四级写入路径：
    //   1. execCommand('insertText')——触发受信 beforeinput；
    //   2. 合成 beforeinput（Lexical 在编辑器 root 监听接管）；
    //   3. 合成 input（Lexical 另有 dispatchCommand 处理链，独立一级）；
    //   4. 重放仅含 text/plain 的合成 paste，借宿主自己的粘贴管道
    //      （paste 命令 → getData('text/plain') → pasteText）。
    // 每级只看「textContent 相对快照变化且 50ms 后保持」，确认即终止，
    // 物理上保证一次调用只发生一次有效写入（详见框架注释）。
    async function insertText(target, text) {
      const el0 = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
        ? target
        : document.activeElement
      if (!el0) return false

      if (el0.tagName === 'TEXTAREA' || el0.tagName === 'INPUT') {
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
        return true
      }

      if (el0.isContentEditable !== true) return false

      el0.focus()
      if (document.activeElement !== el0) return false

      // 串行尝试 + 异步确认的插入框架。
      //
      // 背景教训（v0.3.7/v0.3.8 实测）：
      // 1. 不能用逐字符断言（includes/长度增量）验证插入——宿主
      //    detect-projection 会把「▧ 图片 #id」引用投影成 chip 节点，
      //    textContent 混入 U+E100-E11D/U+FFFC 等不可见占位字符，视觉
      //    完整但逐字符匹配失败，会把成功误判为失败；
      // 2. 不能在某级「验证失败」后径直走下一级——WKWebView 里
      //    execCommand、合成 beforeinput、合成 input、paste 重放全都
      //    能驱动 Lexical 写入，误判失败会导致重复插入（一次粘贴出现
      //    四条相同引用）。
      //
      // 因此每级尝试只做一件事：执行写入动作，textContent 相对初始
      // 快照发生变化且 50ms 后仍然保持（防 Lexical 受控模式对外部 DOM
      // 写入的异步回滚），才算该级成功并立即终止；否则继续下一级。
      // 每级最多写入一次，全链最多发生一次有效写入。
      const before = el0.textContent

      const attempt = async (write) => {
        try {
          write()
        } catch {
          return false
        }
        if (el0.textContent === before) return false
        await new Promise((resolve) => setTimeout(resolve, 50))
        return el0.textContent !== before
      }

      // 级别一：execCommand——Chromium/Safari 下触发受信 beforeinput。
      if (await attempt(() => {
        document.execCommand('insertText', false, text)
      })) return true

      // 级别二：合成 beforeinput，Lexical 在编辑器 root 监听并接管。
      if (await attempt(() => {
        el0.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: text,
          bubbles: true,
          cancelable: true,
        }))
      })) return true

      // 级别三：合成 input（独立一级——Lexical 对 input 事件另有
      // dispatchCommand 处理链，与 beforeinput 配对发送会双写）。
      if (await attempt(() => {
        el0.dispatchEvent(new InputEvent('input', {
          inputType: 'insertText',
          data: text,
          bubbles: true,
        }))
      })) return true

      // 级别四：重放纯文本 paste，走宿主自己的粘贴管道（paste 命令 →
      // getData('text/plain') → pasteText）。合成 paste 无原生默认行为、
      // 无 file 项，本插件自身的 handlePaste 不会递归接管。
      if (await attempt(() => {
        const transfer = new DataTransfer()
        transfer.setData('text/plain', text)
        el0.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }))
      })) return true

      return false
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
      const body = await response.json()
      let id = typeof body.id === 'string' ? body.id : ''
      if (!id) {
        const legacyLocation = typeof body.ref === 'string'
          ? body.ref
          : typeof body.path === 'string' ? body.path : ''
        id = /paste-([A-Za-z0-9_-]{6,32})(?:\/|$)/.exec(legacyLocation)?.[1] ?? ''
      }
      if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
        throw new Error('上传服务版本不一致，请完整重启 DSH')
      }
      return { ...body, id }
    }

    // 用单色符号和中文括号表示图片：不使用 Emoji，也不用会被转义的前导空格。
    function attachmentReference(id) {
      return `「▧ 图片 #${id}」`
    }

    // 获取当前模型标签。aria-label 形如「选择模型，当前 DeepSeek V4 Flash」
    // 或「Select model, current …」。只保留模型（可能带 Provider 前缀）部分，
    // 前缀文案不参与服务端匹配，避免「当前」这类词污染 Provider 判定。
    function currentModelLabel() {
      const buttons = document.querySelectorAll('button[aria-label]')
      for (const button of buttons) {
        const label = button.getAttribute('aria-label') || ''
        const match = /(?:选择模型|select model|current model)\s*[,，:]?\s*(.+)/i.exec(label)
        if (match) return match[1].trim()
      }
      return ''
    }

    // 判断是否需要接管粘贴（模型不支持图片时），带 60s 缓存
    // 返回值：true=接管 | false=模型原生支持图片 | undefined=无法判断
    const verdicts = new Map()
    const verdictRequests = new Map()
    // verdict 临近过期（提前 5s）时主动续期，避免「60s 过期后首次粘贴」
    // 的放行窗口；与 5s 的 refreshPasteState 轮询无关（那只刷配置开关）。
    const verdictRefreshTimers = new Map()

    function scheduleVerdictRefresh(label) {
      const existing = verdictRefreshTimers.get(label)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        verdictRefreshTimers.delete(label)
        verdicts.delete(label)
        void shouldTakeover(label)
      }, VERDICT_MAX_AGE_MS - 5000)
      verdictRefreshTimers.set(label, timer)
    }

    // 粘贴监听必须在同步阶段知道开关状态，否则无法安全地决定是否
    // preventDefault。配置不可读时采用 fail-closed：让宿主原生粘贴继续工作。
    let pasteEnabled = false
    let pasteConfigReady = false
    let pasteConfigRequest = null

    async function refreshPasteState() {
      if (pasteConfigRequest) return pasteConfigRequest
      pasteConfigRequest = fetch(CONFIG_ROUTE)
        .then((response) => {
          if (!response.ok) throw new Error(`config status ${response.status}`)
          return response.json()
        })
        .then((data) => {
          pasteEnabled = data?.config?.enabled === true
          pasteConfigReady = true
          prefetchCurrentVerdict()
          return pasteEnabled
        })
        .catch(() => false)
        .finally(() => { pasteConfigRequest = null })
      return pasteConfigRequest
    }

    // 外部修改最多 5 秒同步到粘贴门控；保存按钮成功后会立即更新。
    void refreshPasteState()
    if (typeof window.setInterval === 'function') {
      window.setInterval(refreshPasteState, 5000)
    }

    function setPasteEnabled(enabled) {
      pasteEnabled = enabled === true
      pasteConfigReady = true
      prefetchCurrentVerdict()
    }

    function cachedTakeover(label) {
      const cached = verdicts.get(label)
      if (!cached) return undefined
      if (Date.now() - cached.at >= VERDICT_MAX_AGE_MS) {
        verdicts.delete(label)
        return undefined
      }
      return cached.takeover
    }

    // 在模型选择完成时预取结果。粘贴事件不能等待网络请求，否则无法
    // 既接管纯文本模型又不破坏原生多模态粘贴；因此首次粘贴前必须预热。
    function prefetchCurrentVerdict() {
      if (!pasteEnabled) return
      const label = currentModelLabel()
      if (label && cachedTakeover(label) === undefined) void shouldTakeover(label)
    }

    function observeModelSelection() {
      const Observer = window.MutationObserver
      if (typeof Observer !== 'function' || !document.documentElement) return
      const observer = new Observer(() => prefetchCurrentVerdict())
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label'],
      })
      prefetchCurrentVerdict()
    }

    async function shouldTakeover(label) {
      if (!label) return undefined

      const cached = cachedTakeover(label)
      if (cached !== undefined) return cached

      const pending = verdictRequests.get(label)
      if (pending) return pending

      const request = fetch(`${VERDICT_ROUTE}?model=${encodeURIComponent(label)}`)
        .then(async (response) => {
          if (!response.ok) return undefined
          const { takeover } = await response.json()
          verdicts.set(label, { takeover, at: Date.now() })
          scheduleVerdictRefresh(label)
          return takeover
        })
        .catch(() => undefined)
        .finally(() => verdictRequests.delete(label))
      verdictRequests.set(label, request)
      return request
    }

    // 粘贴事件处理
    async function handlePaste(event) {
      const files = imageFilesOf(event)
      if (files.length === 0) return

      // 关闭桥接或配置尚未加载时，绝不能取消宿主原生粘贴事件。
      if (!pasteConfigReady || !pasteEnabled) return

      const label = currentModelLabel()
      const cached = label ? cachedTakeover(label) : undefined
      if (cached !== true) {
        // 异步判定无法追回已经传播的事件；先放行本次粘贴，结果缓存后
        // 下一次再接管。这样原生多模态模型不会被“放回剪贴板”破坏。
        void shouldTakeover(label)
        return
      }

      // 只有已确认需要桥接时才同步抢占，避免破坏原生多模态粘贴。
      event.preventDefault()
      event.stopPropagation()

      for (const file of files) {
        try {
          const { id } = await uploadImage(file)
          const text = attachmentReference(id)
          const ok = await insertText(event.target, text)
          if (!ok) await insertText(event.target, '[图片插入失败: 输入框不支持插入]')
        } catch (error) {
          await insertText(event.target, `[图片上传失败: ${error.message}]`)
        }
      }
    }

    // 注册粘贴监听（捕获阶段，优先于其他处理器）
    document.addEventListener('paste', handlePaste, { capture: true })
    observeModelSelection()

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
      // 当前 bundle 使用 Field({ label }, child) 调用；同时兼容标准
      // props.children，避免控件因额外函数参数被静默丢弃。
      const rest = Array.prototype.slice.call(arguments, 1)
      const content = props.children !== undefined
        ? (Array.isArray(props.children) ? props.children : [props.children])
        : rest
      return el('div', { className: 'vb-field' },
        el('div', { className: 'vb-label' }, props.label),
        el('div', { className: 'vb-control' }, ...content))
    }

    // 主分节组件
    function VisionBridgeSection() {
      const [open, setOpen] = useState(false)
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState(null)
      const [draft, setDraft] = useState(null)     // 编辑中的表单
      const [saved, setSaved] = useState(null)     // 服务端已保存的 config
      const [status, setStatus] = useState(null)   // 服务端 status（DSH Provider 目录等）
      const [revision, setRevision] = useState(undefined)
      const [saving, setSaving] = useState(false)
      const [testing, setTesting] = useState(false)
      const [message, setMessage] = useState(null)   // { kind: 'ok'|'bad'|'info', text }
      const [testResult, setTestResult] = useState(null)
      const [apiKeyInput, setApiKeyInput] = useState('')
      const [clearApiKey, setClearApiKey] = useState(false)

      const submenu = useCallback((body, hasPendingChanges = false) => el('div', {
        className: open ? 'vb-card open' : 'vb-card',
      },
      el('button', {
        type: 'button',
        className: 'vb-cardHeader',
        'aria-expanded': open,
        'aria-label': `${open ? '收起' : '展开'}：视觉桥接`,
        onClick: () => setOpen((value) => !value),
      },
      el('span', { className: 'vb-cardHeadText' },
        el('span', { className: 'vb-cardTitle' }, '视觉桥接'),
        el('span', { className: 'vb-cardSubtitle' }, '为纯文本模型桥接 DSH 视觉 Provider')),
      hasPendingChanges ? el('span', { className: 'vb-cardPending' }, '未保存') : null,
      el('span', { className: 'vb-cardChevron', 'aria-hidden': 'true' }, '⌄')),
      open ? el('div', { className: 'vb-cardBody' }, body) : null), [open])

      useEffect(() => {
        ensureStyle()
        let alive = true
        api.load()
          .then((data) => {
            if (!alive) return
            setSaved(data.config)
            setStatus(data.status)
            setRevision(data.revision)
            setPasteEnabled(data.config?.enabled)
            setDraft({
              enabled: data.config.enabled,
              providerMode: data.config.providerMode,
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

      const dshProviders = status?.dshProviders ?? []
      const selectedDshProvider = dshProviders.find((provider) => provider.id === draft?.provider)

      const onDshProviderChange = useCallback((providerId) => {
        const provider = dshProviders.find((item) => item.id === providerId)
        const firstImageModel = provider?.models?.find((model) => model.imageCapable) ?? provider?.models?.[0]
        setDraft((prev) => ({
          ...prev,
          providerMode: 'dsh',
          provider: providerId,
          model: firstImageModel?.id ?? '',
        }))
      }, [dshProviders])

      const useCustomProvider = useCallback(() => {
        setDraft((prev) => ({
          ...prev,
          providerMode: 'custom',
          provider: '',
          baseUrl: '',
          model: '',
          apiKeyEnv: '',
        }))
        setApiKeyInput('')
        setClearApiKey(true)
      }, [])

      const dirty = useMemo(() => {
        if (!draft || !saved) return false
        return draft.enabled !== saved.enabled
          || draft.providerMode !== saved.providerMode
          || draft.provider !== saved.provider
          || draft.baseUrl !== saved.baseUrl
          || draft.model !== saved.model
          || draft.apiKeyEnv !== saved.apiKeyEnv
          || Number(draft.timeout) !== saved.timeout
          || apiKeyInput !== ''
          || clearApiKey
      }, [draft, saved, apiKeyInput, clearApiKey])

      const doSave = useCallback(async () => {
        if (saving) return
        setSaving(true)
        setMessage(null)
        try {
          const patch = {
            enabled: draft.enabled,
            providerMode: draft.providerMode,
            provider: draft.provider,
            baseUrl: draft.baseUrl.trim(),
            model: draft.model.trim(),
            apiKeyEnv: draft.apiKeyEnv.trim(),
            timeout: Number(draft.timeout) || 90,
          }
          if (apiKeyInput.trim() !== '') patch.apiKey = apiKeyInput.trim()
          if (clearApiKey && apiKeyInput.trim() === '') patch.clearApiKey = true
          const data = await api.save(patch, revision)
          setSaved(data.config)
          setStatus(data.status)
          setRevision(data.revision)
          setPasteEnabled(data.config?.enabled)
          setApiKeyInput('')
          setClearApiKey(false)
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
      }, [draft, apiKeyInput, clearApiKey, revision, saving])

      const doReload = useCallback(async () => {
        setMessage(null)
        setTestResult(null)
        try {
          const data = await api.load()
          setSaved(data.config)
          setStatus(data.status)
          setRevision(data.revision)
          setPasteEnabled(data.config?.enabled)
          setDraft({
            enabled: data.config.enabled,
            providerMode: data.config.providerMode,
            provider: data.config.provider,
            baseUrl: data.config.baseUrl,
            model: data.config.model,
            apiKeyEnv: data.config.apiKeyEnv,
            timeout: String(data.config.timeout),
          })
          setApiKeyInput('')
          setClearApiKey(false)
          // 从「配置加载失败」错误态恢复：不置 null 的话上方
          // if (loadError !== null) 永远命中错误视图，「重新加载」点了没反应。
          setLoadError(null)
          setLoading(false)
          setMessage({ kind: 'ok', text: '已重新加载' })
        } catch (error) {
          // 重新加载失败也同步到错误态，保证面板状态与真实加载结果一致。
          setLoadError(error.message)
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
        return submenu(el('p', { className: 'vb-note' }, '正在加载配置…'))
      }

      if (loadError !== null) {
        return submenu(el('div', { className: 'vb-section' },
          el('p', { className: 'vb-msg bad' }, `配置加载失败：${loadError}`),
          el('div', { className: 'vb-buttons' },
            el('button', { className: 'vb-btn ghost', onClick: doReload }, '重新加载'))))
      }

      if (draft === null || saved === null) {
        return submenu(el('p', { className: 'vb-note' }, '暂无配置'))
      }

      const keySourceTitle = saved.keySource === 'credentials'
        ? `从 DSH 凭据库 ${saved.apiKeyEnv} 解析`
        : saved.keySource === 'env' ? `从环境变量 ${saved.apiKeyEnv} 解析` : '存储于 settings.yaml'
      const keySourceText = saved.keySource === 'credentials' || saved.keySource === 'env'
        ? saved.apiKeyEnv : 'settings'
      const keyChip = saved.providerMode === 'dsh'
        ? el('span', { className: 'vb-chip ok' }, '● 凭据由 DSH Provider 管理')
        : saved.keyResolved
          ? el('span', { className: 'vb-chip ok', title: keySourceTitle }, `● API Key 已就绪（${keySourceText}）`)
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
          '停用后不再接管图片粘贴'))

      const providerRow = draft.providerMode === 'dsh'
        ? Field({ label: 'DSH Provider' },
            el('div', { className: 'vb-buttons' },
              el('select', {
                className: 'vb-input vb-select',
                value: draft.provider,
                onChange: (e) => onDshProviderChange(e.target.value),
              },
                el('option', { value: '' }, dshProviders.length ? '请选择已添加的 Provider' : 'DSH 中暂无可用 Provider'),
                dshProviders.map((provider) => el('option', { key: provider.id, value: provider.id }, provider.label))),
              el('button', { type: 'button', className: 'vb-btn ghost', onClick: useCustomProvider }, '新增 Provider')),
            el('p', { className: 'vb-note' }, '列表实时来自 DSH；Base URL、凭据和调用协议均由 DSH Provider 管理。'))
        : Field({ label: 'Provider 名称' },
            el('div', { className: 'vb-buttons' },
              el('input', {
                className: 'vb-input',
                type: 'text',
                value: draft.provider,
                placeholder: '自定义 Provider 名称',
                onChange: (e) => setField('provider', e.target.value),
              }),
              el('button', {
                type: 'button',
                className: 'vb-btn ghost',
                onClick: () => setDraft((prev) => ({ ...prev, providerMode: 'dsh', provider: '', model: '' })),
              }, '使用 DSH Provider')),
            el('p', { className: 'vb-note' }, '这是本插件私有的 OpenAI 兼容直连配置，不会注册到 DSH 全局 Provider 列表。'))

      const baseUrlRow = draft.providerMode === 'custom' ? Field({ label: 'Base URL' },
        el('input', {
          className: 'vb-input',
          type: 'text',
          value: draft.baseUrl,
          placeholder: 'https://.../v1',
          onChange: (e) => setField('baseUrl', e.target.value),
        })) : null

      const modelRow = Field({ label: '视觉模型' },
        draft.providerMode === 'dsh'
          ? el('select', {
              className: 'vb-input vb-select',
              value: draft.model,
              disabled: !selectedDshProvider,
              onChange: (e) => setField('model', e.target.value),
            },
              el('option', { value: '' }, selectedDshProvider ? '请选择模型' : '请先选择 Provider'),
              (selectedDshProvider?.models ?? []).map((model) => el('option', { key: model.id, value: model.id },
                `${model.label}${model.imageCapable ? ' · 支持图片' : ' · 未声明图片能力'}`)))
          : el('input', {
              className: 'vb-input',
              type: 'text',
              value: draft.model,
              placeholder: '视觉模型 ID',
              onChange: (e) => setField('model', e.target.value),
            }))

      const apiKeyEnvRow = draft.providerMode === 'custom' ? Field({ label: 'Key 环境变量' },
        el('input', {
          className: 'vb-input',
          type: 'text',
          value: draft.apiKeyEnv,
          placeholder: 'VISION_API_KEY',
          onChange: (e) => setField('apiKeyEnv', e.target.value),
        }),
        el('p', { className: 'vb-note' },
          '可在 DSH 凭据中配置该变量；或直接在下方填入 Key（存入 settings.yaml）。')) : null

      const apiKeyRow = draft.providerMode === 'custom' ? Field({ label: 'API Key' },
        el('input', {
          className: 'vb-input',
          type: 'password',
          value: apiKeyInput,
          placeholder: saved.keyResolved ? '已配置（留空保持不变）' : '未配置，可在此填入',
          onChange: (e) => setApiKeyInput(e.target.value),
          autoComplete: 'new-password',
        })) : null

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
        ' 段；自定义 Provider 的 API Key 永远不会回显到浏览器。')

      const chipsRow = el('div', { className: 'vb-chips' },
        el('span', { className: `vb-chip ${saved.enabled ? 'ok' : 'bad'}` },
          saved.enabled ? '● 已启用' : '● 已停用'),
        keyChip,
        saved.providerMode === 'dsh'
          ? status?.llmService && status?.attachmentService
            ? el('span', { className: 'vb-chip ok' }, '● DSH Provider 通道已连接')
            : el('span', { className: 'vb-chip bad' }, '● DSH Provider 通道不完整')
          : status?.credentialsService
            ? el('span', { className: 'vb-chip ok' }, '● 凭据服务已连接')
            : el('span', { className: 'vb-chip bad' }, '● 凭据服务不可用'),
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
        '为当前纯文本模型桥接视觉能力：选择 DSH 已添加的视觉 Provider，或新增一个 OpenAI 兼容直连 Provider。粘贴图片或调用 ',
        el('span', { className: 'vb-mono' }, 'vision_bridge_read_image'),
        ' 工具时，先由下方多模态模型识别为结构化文本证据，再交给当前模型。')

      return submenu(el('div', { className: 'vb-section' },
        intro,
        chipsRow,
        formGroup), dirty)
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

      slots.inject('settings.plugin.item', () => {
        const dispose = slots.register({
          name: 'settings.plugin.item',
          key: 'vision-bridge',
          inject: () => ({ api }),
        }, VisionBridgeSection)
        return () => dispose()
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
