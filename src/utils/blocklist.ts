import { BLOCKED_URLS } from '../config/blocklist'

export function normalizeImageUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS image URLs are supported')
  }
  // Fragment 不会发送给上游，不应影响匹配。
  url.hash = ''
  return url.href
}

const blockedUrls = new Set(BLOCKED_URLS.map(normalizeImageUrl))

export function isBlockedUrl(url: string): boolean {
  return blockedUrls.has(normalizeImageUrl(url))
}
