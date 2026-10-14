import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const counts = { image: 0, css: 0, script: 0, broken: 0 }
const server = await createServer({
  configFile: false,
  root,
  plugins: [vue(), {
    name: 'email-security-probe-counter',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (path === '/__email_security_results__') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(counts))
        } else if (path?.startsWith('/__email_security_probe__/')) {
          const key = path.split('/').pop()
          if (Object.hasOwn(counts, key)) counts[key]++
          res.statusCode = key === 'broken' ? 404 : 200
          res.setHeader('Content-Type', 'image/png')
          res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8l8AAAAASUVORK5CYII=', 'base64'))
        } else next()
      })
    }
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 3101, strictPort: true }
})
await server.listen()
console.log('Email safety check: http://127.0.0.1:3101/tests/browser-smoke.html')
