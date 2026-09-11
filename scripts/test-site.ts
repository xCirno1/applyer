import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const siteRoot = resolve(fileURLToPath(new URL('../test/fixtures/job-site/', import.meta.url)))
const host = process.env.APPLYER_TEST_SITE_HOST || '127.0.0.1'
const portText = process.env.APPLYER_TEST_SITE_PORT || '8765'
const port = Number.parseInt(portText, 10)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`APPLYER_TEST_SITE_PORT must be an integer from 1 to 65535, received: ${portText}`)
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers
  })
  response.end(body)
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' })
    return
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', `http://${host}:${port}`).pathname)
  } catch {
    send(response, 400, 'Bad request')
    return
  }

  if (pathname === '/server-error') {
    send(response, 500, '<h1>Intentional server error</h1>', { 'Content-Type': 'text/html; charset=utf-8' })
    return
  }
  if (pathname === '/redirect') {
    send(response, 302, '', { Location: '/fillable.html' })
    return
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = resolve(siteRoot, relativePath)
  if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}${sep}`)) {
    send(response, 403, 'Forbidden')
    return
  }

  readFile(filePath, (error, content) => {
    if (error) {
      send(response, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Server error')
      return
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream'
    })
    response.end(request.method === 'HEAD' ? undefined : content)
  })
})

server.on('error', (error) => {
  const serverError = error as NodeJS.ErrnoException
  const message =
    serverError.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop the other server or set APPLYER_TEST_SITE_PORT.`
      : `Could not start the Applyer test job site: ${serverError.message}`
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})

server.listen(port, host, () => {
  process.stdout.write(`Applyer test job site: http://${host}:${port}\n`)
  process.stdout.write(`Fixtures: ${siteRoot}\n`)
  process.stdout.write('Press Ctrl+C to stop.\n')
})

function shutdown(): void {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
