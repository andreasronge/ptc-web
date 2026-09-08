import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { PtcWebError } from './errors.js'

export class AccessPolicy {
  constructor(readonly localOrigins: ReadonlySet<string>) {}

  async assertAllowed(rawUrl: string): Promise<URL> {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new PtcWebError('access_denied', 'URL is invalid')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new PtcWebError('access_denied', 'only HTTP(S) destinations are allowed')
    }
    if (url.username || url.password) throw new PtcWebError('access_denied', 'URL credentials are not allowed')
    if (this.localOrigins.has(url.origin)) return url

    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(hostname) ? [{ address: hostname }] : await this.resolve(hostname)
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new PtcWebError('access_denied', 'destination resolves to a non-public address')
    }
    return url
  }

  private async resolve(hostname: string): Promise<Array<{ address: string }>> {
    try {
      return await lookup(hostname, { all: true, verbatim: true })
    } catch {
      throw new PtcWebError('unavailable', 'destination could not be resolved')
    }
  }
}

export function isPublicAddress(value: string): boolean {
  try {
    const address = ipaddr.parse(value)
    if (address.kind() === 'ipv6') {
      const ipv6 = address as ipaddr.IPv6
      if (ipv6.isIPv4MappedAddress()) return isPublicAddress(ipv6.toIPv4Address().toString())
    }
    return address.range() === 'unicast'
  } catch {
    return false
  }
}

export function isNonNetworkUrl(rawUrl: string): boolean {
  return rawUrl === 'about:blank' || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')
}
