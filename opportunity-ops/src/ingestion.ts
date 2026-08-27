import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { SourceSnapshot } from './domain.js'

const DEFAULT_MAX_BYTES = 1_000_000

export type IngestionOptions = { maxBytes?: number; fetchImpl?: typeof fetch }

function cleanDocument(input: string): string {
  const embeddedDeadline = input.match(/(?:"endDate"|"end_date")\s*:\s*"([^"\s]+)"/i)?.[1]
  const cleaned = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, '\ntitle: $1\n')
    .replace(/<\/(p|div|li|h[1-6]|br|section|article|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim()
  return embeddedDeadline ? `deadline: ${embeddedDeadline}\n${cleaned}` : cleaned
}

function snapshot(url: string, text: string, fetchedAt: string): SourceSnapshot {
  const version = createHash('sha256').update(text).digest('hex').slice(0, 16)
  return { url, version, text, fetchedAt }
}

function assertSize(text: string, maxBytes: number): void {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`Source exceeds ${maxBytes} byte limit`)
}

export async function ingestSource(source: string, options: IngestionOptions = {}): Promise<SourceSnapshot> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const fetchedAt = new Date().toISOString()
  if (source.startsWith('file:')) {
    const raw = await readFile(new URL(source), 'utf8')
    const text = cleanDocument(raw)
    assertSize(text, maxBytes)
    return snapshot(source, text, fetchedAt)
  }
  if (!/^https?:\/\//i.test(source)) {
    const fileUrl = pathToFileURL(source).href
    const raw = await readFile(source, 'utf8')
    const text = cleanDocument(raw)
    assertSize(text, maxBytes)
    return snapshot(fileUrl, text, fetchedAt)
  }
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(source, { headers: { accept: 'text/html,text/plain,application/json', 'user-agent': 'Opportunity-Ops/0.1 (+local research agent)' } })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to reach source ${source}. Check the URL and network connection. (${reason})`)
  }
  if (!response.ok) throw new Error(`Source fetch failed: HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxBytes) throw new Error(`Source exceeds ${maxBytes} byte limit`)
  const raw = await response.text()
  const text = cleanDocument(raw)
  assertSize(text, maxBytes)
  return snapshot(source, text, fetchedAt)
}