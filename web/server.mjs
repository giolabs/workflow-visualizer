// The live rack for clients that attach no drawing surface: a local HTTP server the plugin starts
// with $.process.spawn and feeds with POST /state. Binds 127.0.0.1 on a free port and prints one
// line, `listening http://127.0.0.1:<port> token=<token>`, that the plugin reads. Writes need the
// token; reads (the page, /state, /events) are open to the local machine. Exits on POST /quit, when
// the parent process is gone, or with the plugin (the engine kills the child with its stream).
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const token = randomBytes(12).toString('hex')
const BODY_MAX = 2 * 1024 * 1024
let state = null
const clients = new Set()

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

const readBody = req =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > BODY_MAX) {
        reject(new Error('body too large'))
        req.destroy()

        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(await readFile(join(dir, 'index.html')))

      return
    }
    if (req.method === 'GET' && url.pathname === '/state') return json(res, 200, state ?? {})
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify(state ?? {})}\n\n`)
      clients.add(res)
      req.on('close', () => clients.delete(res))

      return
    }
    if (req.method === 'POST') {
      if (req.headers['x-wv-token'] !== token) return json(res, 403, { error: 'token' })
      const body = await readBody(req)
      if (url.pathname === '/state') {
        try {
          state = JSON.parse(body)
        } catch {
          return json(res, 400, { error: 'bad json' })
        }
        for (const client of clients) client.write(`data: ${body}\n\n`)

        return json(res, 200, { ok: true, clients: clients.size })
      }
      if (url.pathname === '/quit') {
        json(res, 200, { ok: true })
        setTimeout(() => process.exit(0), 20)

        return
      }
    }
    res.writeHead(404)
    res.end()
  } catch (err) {
    json(res, 500, { error: String(err && err.message ? err.message : err) })
  }
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  process.stdout.write(`listening http://127.0.0.1:${port} token=${token}\n`)
})

// SSE heartbeat, and a quiet exit once the plugin's process is gone.
setInterval(() => {
  for (const client of clients) client.write(': ping\n\n')
}, 15000)
const parent = process.ppid
setInterval(() => {
  try {
    process.kill(parent, 0)
  } catch {
    process.exit(0)
  }
}, 5000)
