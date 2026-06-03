import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { hostGuard, isLoopbackHost } from '../../src/security/host'

describe('isLoopbackHost', () => {
  it('accepts loopback hostnames with or without a port', () => {
    for (const h of [
      'localhost',
      'localhost:5173',
      '127.0.0.1',
      '127.0.0.1:443',
      '::1',
      '[::1]',
      '[::1]:5173',
      'LOCALHOST' // case-insensitive
    ]) {
      expect(isLoopbackHost(h), h).toBe(true)
    }
  })

  it('rejects non-loopback / spoofed hosts', () => {
    for (const h of [
      'evil.com',
      'evil.com:80',
      'localhost.evil.com', // suffix attack
      'notlocalhost',
      '0.0.0.0',
      '169.254.169.254', // cloud metadata
      '10.0.0.5',
      ''
    ]) {
      expect(isLoopbackHost(h), h).toBe(false)
    }
  })
})

describe('hostGuard middleware', () => {
  function run(host: string | undefined): {
    nexted: boolean
    status: number | undefined
    body: unknown
  } {
    let status: number | undefined
    let body: unknown
    const res = {
      status(code: number) {
        status = code
        return this
      },
      json(payload: unknown) {
        body = payload
        return this
      }
    } as unknown as Response
    const req = { headers: { host } } as unknown as Request
    const next = vi.fn()
    hostGuard()(req, res, next)
    return { nexted: next.mock.calls.length > 0, status, body }
  }

  it('passes a loopback Host through', () => {
    const r = run('127.0.0.1:5173')
    expect(r.nexted).toBe(true)
    expect(r.status).toBeUndefined()
  })

  it('rejects a spoofed Host with 403 forbidden_host', () => {
    const r = run('evil.com')
    expect(r.nexted).toBe(false)
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ error: 'forbidden_host' })
  })

  it('rejects a missing Host with 403 (HTTP/1.1 requires Host)', () => {
    const r = run(undefined)
    expect(r.nexted).toBe(false)
    expect(r.status).toBe(403)
  })
})
