import createDOMPurify from 'dompurify'

const purifier = createDOMPurify(window)
const forbiddenTags = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'base', 'meta', 'link', 'form', 'input', 'button', 'textarea', 'select',
  'option', 'audio', 'video', 'source', 'track', 'svg', 'math', 'template'
]
const editorStyles = new Set([
  'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style',
  'text-align', 'text-decoration', 'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align', 'width', 'height',
  'max-width', 'min-width', 'padding', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-width', 'border-style', 'border-color', 'border-collapse', 'border-spacing'
])

function cleanDocument(html, { images = false, editor = false } = {}) {
  const root = purifier.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    SANITIZE_NAMED_PROPS: true,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: editor ? [...forbiddenTags, 'style'] : forbiddenTags,
    FORBID_ATTR: [
      'srcset', 'ping', 'download', 'autofocus', 'is',
      ...(!images ? ['src', 'background', 'poster'] : [])
    ]
  })

  for (const link of root.querySelectorAll('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href'), window.location.href)
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) {
        link.removeAttribute('href')
        continue
      }
      link.setAttribute('href', url.href)
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
      link.setAttribute('referrerpolicy', 'no-referrer')
    } catch {
      link.removeAttribute('href')
    }
  }

  for (const image of root.querySelectorAll('img[src]')) {
    const src = image.getAttribute('src')
    const inlineImage = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,/i.test(src)
    try {
      const url = new URL(src, window.location.href)
      const localBlob = images === 'inline' && url.protocol === 'blob:' && url.origin === window.location.origin
      const remoteImage = images === true && ['https:', 'http:'].includes(url.protocol)
      if (!inlineImage && !localBlob && !remoteImage) image.removeAttribute('src')
    } catch {
      image.removeAttribute('src')
    }
    image.setAttribute('referrerpolicy', 'no-referrer')
  }
  if (editor) {
    for (const element of root.querySelectorAll('[style]')) {
      // Keep typography and table layout, but never resource-loading or overlay CSS.
      const styles = Array.from(element.style)
        .filter(name => editorStyles.has(name))
        .map(name => [name, element.style.getPropertyValue(name)])
      element.removeAttribute('style')
      for (const [name, value] of styles) element.style.setProperty(name, value)
      if (!element.style.length) element.removeAttribute('style')
    }
    for (const element of root.querySelectorAll('[background]')) element.removeAttribute('background')
  }
  return root
}

// Only render this document in the sandboxed email frame, never in the app DOM.
export function buildEmailDocument(html, { images = false } = {}) {
  const root = cleanDocument(html, { images })
  const doc = root.ownerDocument
  const head = root.querySelector('head')
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = [
    "default-src 'none'", "script-src 'none'", "style-src 'unsafe-inline'",
    `img-src ${images ? 'https: http: data:' : "'none'"}`,
    "connect-src 'none'", "font-src 'none'", "media-src 'none'",
    "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"
  ].join('; ')
  const referrer = doc.createElement('meta')
  referrer.name = 'referrer'
  referrer.content = 'no-referrer'
  const style = doc.createElement('style')
  style.textContent = `
    html { background: #fff; color: #13181d; }
    body { margin: 12px; font: 14px/1.5 Inter, "Helvetica Neue", Helvetica, "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
      overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    a { color: #0e70df; }
  `
  // The policy must precede any sender-supplied styles or resources.
  head.prepend(policy, referrer, style)
  return {
    srcdoc: '<!doctype html>' + root.outerHTML,
    hasImages: Boolean(root.querySelector('img')) || /\b(?:url|image-set)\s*\(/i.test(String(html || ''))
  }
}

export function emailHtmlToText(html) {
  const fragment = purifier.sanitize(String(html || ''), {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: [...forbiddenTags, 'style', 'title']
  })
  return (fragment.textContent || '').replace(/\s+/g, ' ').trim()
}

// Quoted mail enters an editable document: remove resource-loading CSS and images.
export function emailHtmlForQuote(html) {
  return cleanDocument(html, { editor: true }).querySelector('body').innerHTML
}

export function emailHtmlForEditor(html) {
  return cleanDocument(html, { images: 'inline', editor: true }).querySelector('body').innerHTML
}

export function escapeEmailText(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char])
}
