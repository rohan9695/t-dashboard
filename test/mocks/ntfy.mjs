// test/mocks/ntfy.mjs
// Stands in for ntfy.sh and records exactly what would have reached the phone:
// topic, Title / Priority / Tags headers, and the message body.
//
// Run standalone:  node test/mocks/ntfy.mjs [port]

import http from 'node:http'

const PORT = Number(process.argv[2] ?? process.env.MOCK_NTFY_PORT ?? 8099)

const received = []

const send = (res, code, body) => {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) })
  res.end(s)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/__notifications') return send(res, 200, received)
  if (url.pathname === '/__health')        return send(res, 200, { ok: true })
  if (url.pathname === '/__reset')         { received.length = 0; return send(res, 200, { ok: true }) }

  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    received.push({
      topic:         url.pathname.replace(/^\//, ''),
      title:         req.headers.title,
      tags:          req.headers.tags,
      priority:      req.headers.priority,
      authorization: req.headers.authorization,
      body,
    })
    send(res, 200, { id: 'mock' })
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-ntfy] listening on ${PORT}`)
})
