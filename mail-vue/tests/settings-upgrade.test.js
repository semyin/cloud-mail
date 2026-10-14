import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../mail-worker/src/entity/orm', () => ({
  default: () => ({ select: () => ({ from: () => ({ get: db.get }) }) })
}))
vi.mock('../../mail-worker/src/utils/file-utils', () => ({ default: {} }))
vi.mock('../../mail-worker/src/service/r2-service', () => ({ default: {} }))
vi.mock('../../mail-worker/src/service/verify-record-service', () => ({ default: {} }))
vi.mock('../../mail-worker/src/security/user-context', () => ({ default: {} }))
vi.mock('../../mail-worker/src/i18n/i18n', () => ({ t: key => key }))

import settingService from '../../mail-worker/src/service/setting-service'

describe('settings cache after an additive database upgrade', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([true, false])('refreshes old settings without requiring a login secret (request context: %s)', async withContext => {
    const old = { emailPrefixFilter: '', resendTokens: {} }
    const upgraded = {
      emailPrefixFilter: '', resendTokens: '{}', title: 'Existing title',
      notice: 0, noticeContent: 'Existing notice', autoCleanDays: 0,
      syncDelete: 1, aiCode: 1, webhookStatus: 1
    }
    db.get.mockResolvedValue({ ...upgraded })
    const values = new Map()
    const c = {
      env: { domain: ['example.com'], kv: { get: vi.fn().mockResolvedValue(old), put: vi.fn() } },
      ...(withContext ? { get: key => values.get(key), set: (key, value) => values.set(key, value) } : {})
    }

    const result = await settingService.query(c)
    expect(result.title).toBe('Existing title')
    expect(result.noticeContent).toBe('Existing notice')
    expect(result.autoCleanDays).toBe(0)
    expect(result.syncDelete).toBe(1)
    expect(result.aiCode).toBe(1)
    expect(result.webhookStatus).toBe(1)
    expect(result.domainList).toEqual(['@example.com'])
    expect(result.emailPrefixFilter).toEqual([])
    expect(c.env.kv.put).toHaveBeenCalledOnce()
    expect(JSON.parse(c.env.kv.put.mock.calls[0][1]).noticeContent).toBe('Existing notice')
  })

  it('reuses an upgraded cache without querying the database again', async () => {
    const c = { env: { domain: ['example.com'], kv: {
      get: vi.fn().mockResolvedValue({ emailPrefixFilter: '', resendTokens: {}, webhookStatus: 1 }),
      put: vi.fn()
    } } }
    await settingService.query(c)
    expect(db.get).not.toHaveBeenCalled()
    expect(c.env.kv.put).not.toHaveBeenCalled()
  })
})
