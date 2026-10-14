// Web server: renders the first page on the server, then the browser takes over as an SPA.
// Also forwards /api/* to the Python API so the browser only talks to one host.
import compression from 'compression'
import express from 'express'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isProd = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 3000)
const apiUrl = (process.env.API_URL || 'http://localhost:8000').replace(/\/$/, '')
const root = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.disable('x-powered-by')

// ---- /api proxy (streams both ways, keeps connections alive) ----
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 })
const api = new URL(apiUrl)
app.use('/api', (req, res) => {
  const upstream = http.request(
    {
      host: api.hostname,
      port: api.port || 80,
      method: req.method,
      path: '/api' + req.url,
      headers: { ...req.headers, host: api.host, 'x-forwarded-for': req.ip },
      agent,
    },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers)
      r.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ detail: 'The server is not reachable right now.' })
  })
  req.pipe(upstream)
})

app.use(compression())

let vite
let template
let render
let manifest = {}
if (isProd) {
  // Hashed assets never change, so browsers and CDNs can cache them for a year.
  app.use('/assets', express.static(path.join(root, 'dist/client/assets'), { immutable: true, maxAge: '1y', index: false }))
  app.use(express.static(path.join(root, 'dist/client'), { index: false, maxAge: '1h' }))
  template = await fs.readFile(path.join(root, 'dist/client/index.html'), 'utf-8')
  manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/.vite/manifest.json'), 'utf-8'))
  render = (await import('./dist/server/entry-server.js')).render
} else {
  const { createServer } = await import('vite')
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  app.use(vite.middlewares)
}

// Tell the browser to fetch the first screen's code and CSS in parallel with the main bundle,
// instead of discovering them only after the main bundle has run.
function preloadLinks(file) {
  const js = new Set()
  const css = new Set()
  const walk = (key) => {
    const chunk = manifest[key]
    if (!chunk || js.has(chunk.file)) return
    if (!chunk.isEntry) js.add(chunk.file) // the main entry is already in the page
    chunk.css?.forEach((c) => css.add(c))
    chunk.imports?.forEach(walk)
  }
  walk(file)
  return [...js].map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`).join('') +
    [...css].map((f) => `<link rel="stylesheet" href="/${f}">`).join('')
}

const escapeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '')
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

app.get('*', async (req, res) => {
  try {
    let html = template
    let renderFn = render
    if (!isProd) {
      html = await vite.transformIndexHtml(req.originalUrl, await fs.readFile(path.join(root, 'index.html'), 'utf-8'))
      renderFn = (await vite.ssrLoadModule('/src/entry-server.tsx')).render
    }
    const out = await renderFn(req.originalUrl, apiUrl)
    html = html
      .replace('<!--app-title-->', escapeHtml(out.title))
      .replace('<!--app-head-->', preloadLinks(out.screenFile))
      .replace('<!--app-html-->', out.html)
      .replace('<!--app-state-->', `<script>window.__HAAT__=${escapeJson(out.state)}</script>`)
    res.status(out.status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html)
  } catch (e) {
    vite?.ssrFixStacktrace(e)
    console.error(e)
    res.status(500).end('Something went wrong')
  }
})

app.listen(port, () => console.log(`Haat web on http://localhost:${port} (API ${apiUrl})`))
