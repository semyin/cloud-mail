import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import EmailBody from '../src/components/shadow-html/index.vue'
import { buildEmailDocument, emailHtmlForEditor, emailHtmlForQuote, emailHtmlToText, escapeEmailText } from '../src/utils/email-html.js'

const parse = html => new DOMParser().parseFromString(html, 'text/html')
const hostile = `<p>Hello &amp; welcome</p>
  <img src="https://tracker.example.invalid/pixel" onerror="fetch('/stolen')">
  <img src="x-probe" onerror="parent.document.body.dataset.compromised='yes'">
  <svg onload="alert(1)"><a href="javascript:alert(1)">SVG</a></svg>
  <script>alert(1)</script>`

describe('untrusted email HTML', () => {
  it('removes the image-event payload and active content while keeping the message', () => {
    const doc = parse(buildEmailDocument(hostile).srcdoc)
    expect(doc.body.textContent).toContain('Hello & welcome')
    expect(doc.querySelector('script,svg,math,iframe,object,embed,[onerror],[onload]')).toBeNull()
    expect(doc.querySelector('img[src],img[srcset]')).toBeNull()
  })

  it.each([
    '<a href="jav&#x61;script:alert(1)" onclick="alert(1)">link</a>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<form><input name="__proto__"><button formaction="javascript:alert(1)">go</button></form>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="data:text/html,bad"></object>'
  ])('rejects dangerous markup and namespace tricks: %s', html => {
    const doc = parse(buildEmailDocument(html, { images: true }).srcdoc)
    expect(doc.querySelector('script,svg,math,form,input,button,iframe,object,embed')).toBeNull()
    for (const el of doc.querySelectorAll('*')) {
      expect([...el.attributes].some(attr => /^on/i.test(attr.name))).toBe(false)
      expect(el.getAttribute('href') || '').not.toMatch(/^javascript:/i)
    }
  })

  it('pins its own policy before sender CSS and removes redirects and base URLs', () => {
    const result = buildEmailDocument(`<html><head>
      <meta http-equiv="refresh" content="0;url=https://tracker.example.invalid">
      <base href="https://tracker.example.invalid"><link rel="stylesheet" href="https://tracker.example.invalid/style">
      <style>@import 'https://tracker.example.invalid/css'; p{background:url(https://tracker.example.invalid/bg)}</style>
      </head><body style="color:red"><p>message</p></body></html>`)
    const doc = parse(result.srcdoc)
    expect(doc.head.firstElementChild.httpEquiv).toBe('Content-Security-Policy')
    expect(doc.head.firstElementChild.content).toContain("script-src 'none'")
    expect(doc.head.firstElementChild.content).toContain("img-src 'none'")
    expect(doc.head.firstElementChild.content).toContain("connect-src 'none'")
    expect(doc.querySelector('base,link,meta[http-equiv="refresh"]')).toBeNull()
    expect(doc.body.style.color).toBe('red')
  })

  it('keeps ordinary table layout, formatting, and safely opened links', () => {
    const doc = parse(buildEmailDocument('<table><tr><td style="color:blue"><strong>Invoice</strong></td></tr></table><a href="https://example.com" target="_top" ping="https://tracker.example.invalid">Open</a>').srcdoc)
    expect(doc.querySelector('td strong').textContent).toBe('Invoice')
    expect(doc.querySelector('td').style.color).toBe('blue')
    expect(doc.querySelector('a').target).toBe('_blank')
    expect(doc.querySelector('a').rel).toBe('noopener noreferrer')
    expect(doc.querySelector('a').hasAttribute('ping')).toBe(false)
  })

  it('only allows images after explicit consent; scripts remain prohibited', () => {
    const doc = parse(buildEmailDocument(hostile, { images: true }).srcdoc)
    expect(doc.querySelector('img').src).toBe('https://tracker.example.invalid/pixel')
    expect(doc.querySelector('[onerror]')).toBeNull()
    expect(doc.head.firstElementChild.content).toContain("script-src 'none'")
    expect(doc.head.firstElementChild.content).toContain('img-src https: http: data:')
  })

  it('extracts preview text without creating resource-loading elements', () => {
    expect(emailHtmlToText(hostile)).toBe('Hello & welcome')
    expect(emailHtmlToText('<style>leak</style><title>hidden</title><p>A &lt; B</p>')).toBe('A < B')
  })

  it('removes scripts, image sources, and CSS before quoting into the editor', () => {
    const html = emailHtmlForQuote(hostile + '<style>@import "https://tracker.example.invalid";</style><p style="background:url(https://tracker.example.invalid)">quoted</p>')
    const doc = parse(html)
    expect(doc.querySelector('script,style,[onerror],[style],img[src]')).toBeNull()
    expect(doc.body.textContent).toContain('quoted')
  })

  it('escapes sender names and plain-text quotes instead of interpreting them as HTML', () => {
    const value = '<img src=x onerror="alert(1)"> & "quoted"'
    const doc = parse(`<pre>${escapeEmailText(value)}</pre>`)
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.querySelector('pre').textContent).toBe(value)
  })

  it('cleans saved drafts while preserving safe formatting and embedded images', () => {
    const doc = parse(emailHtmlForEditor(`<p style="color:blue;text-align:center;background-image:url(https://tracker.example.invalid);position:fixed">Draft</p>
      <img src="data:image/png;base64,aGVsbG8=" onerror="alert(1)">
      <img src="https://tracker.example.invalid/pixel">`))
    const paragraph = doc.querySelector('p')
    expect(paragraph.style.color).toBe('blue')
    expect(paragraph.style.textAlign).toBe('center')
    expect(paragraph.style.backgroundImage).toBe('')
    expect(paragraph.style.position).toBe('')
    expect(doc.querySelectorAll('img[src]')).toHaveLength(1)
    expect(doc.querySelector('[onerror]')).toBeNull()
  })
})

describe('email isolation and consent', () => {
  let wrapper
  afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

  it('never enables frame scripts and resets image consent for the next message', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    wrapper = mount(EmailBody, {
      props: { html: hostile },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {
        emailBody: 'Email body', emailImagesBlocked: 'Images blocked', showEmailImages: 'Show images'
      } } })] }
    })
    const frame = wrapper.get('iframe')
    expect(frame.attributes('sandbox').split(' ')).not.toContain('allow-scripts')
    expect(frame.attributes('sandbox').split(' ')).not.toContain('allow-forms')
    expect(parse(frame.attributes('srcdoc')).querySelector('img[src]')).toBeNull()
    await wrapper.get('button').trigger('click')
    expect(parse(frame.attributes('srcdoc')).querySelector('img[src]')).not.toBeNull()
    await wrapper.setProps({ html: '<p>Next</p><img src="https://tracker.example.invalid/next">' })
    expect(wrapper.get('button').text()).toBe('Show images')
    expect(parse(frame.attributes('srcdoc')).querySelector('img[src]')).toBeNull()
  })
})
