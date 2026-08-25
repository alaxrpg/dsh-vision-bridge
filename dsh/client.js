// dsh-vision-bridge: 浏览器端粘贴拦截
// 拦截图片粘贴，上传到服务端，返回路径供模型识别

window.__ModuleLoader__.load({
  id: 'dsh-vision-bridge/client',
  factory: () => {
    const PASTE_ROUTE = '/vision-bridge/paste'
    const VERDICT_ROUTE = '/vision-bridge/verdict'
    const VERDICT_MAX_AGE_MS = 60000

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
      const el = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
        ? target
        : document.activeElement
      if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return

      el.focus()
      let inserted = false
      try {
        inserted = document.execCommand('insertText', false, text)
      } catch {
        inserted = false
      }
      if (!inserted) {
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el, el.value + text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
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

    // 判断是否需要接管粘贴（模型不支持图片时）
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

    console.log('[dsh-vision-bridge] 浏览器端已加载')
  },
})
