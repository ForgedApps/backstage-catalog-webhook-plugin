import type {
  AuthService,
  DiscoveryService
} from '@backstage/backend-plugin-api'
import { mockServices } from '@backstage/backend-test-utils'
import { CatalogClient } from '@backstage/catalog-client'
import { ConfigReader } from '@backstage/config'
import { resetCache } from './cache'
import { createWebhookHandler } from './webhookHandler'

jest.mock('@backstage/catalog-client')

describe('WebhookProcessor', () => {
  beforeEach(() => jest.useFakeTimers())

  it('should not start processing when remoteEndpoint is not configured', async () => {
    const mockConfig = new ConfigReader({})
    const mockLogger = mockServices.logger.mock()
    const mockCache = mockServices.cache.mock()
    const mockScheduler = mockServices.scheduler.mock()

    const processor = createWebhookHandler(
      {} as AuthService,
      mockCache,
      mockConfig,
      {} as DiscoveryService,
      mockLogger,
      mockScheduler
    )

    await processor.start()

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Catalog webhook not configured, skipping'
    )
  })

  it('should start processing when properly configured', async () => {
    const mockAuth = {
      getPluginRequestToken: jest.fn().mockResolvedValue('test-token'),
      getOwnServiceCredentials: jest.fn().mockResolvedValue({})
    }

    const mockCache = mockServices.cache.mock()

    const mockConfig = new ConfigReader({
      catalog: {
        webhook: {
          remoteEndpoint: 'https://example.com/webhook',
          secret: 'test-secret',
          intervalMinutes: 1
        }
      }
    })

    const mockDiscovery: DiscoveryService = {
      getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007'),
      getExternalBaseUrl: jest.fn()
    }

    const mockLogger = mockServices.logger.mock()

    const mockScheduler = mockServices.scheduler.mock()

    const mockCatalogClient = {
      getEntities: jest.fn().mockResolvedValue({
        items: [
          { metadata: { uid: 'uid1', etag: 'etag1' } },
          { metadata: { uid: 'uid2', etag: 'etag2' } }
        ]
      })
    }
    ;(CatalogClient as jest.Mock).mockImplementation(() => mockCatalogClient)

    global.fetch = jest.fn().mockResolvedValue({
      ok: true
    })

    const processor = createWebhookHandler(
      mockAuth as unknown as AuthService,
      mockCache,
      mockConfig,
      mockDiscovery,
      mockLogger,
      mockScheduler
    )

    await processor.start()

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Catalog webhook started and reporting to https://example.com/webhook every 1 minute'
    )

    await processor.processEntities(
      mockCatalogClient as unknown as CatalogClient,
      'https://example.com/webhook',
      'test-secret'
    )

    expect(mockCatalogClient.getEntities).toHaveBeenCalled()
    expect(mockAuth.getPluginRequestToken).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.any(Object)
    )

    await resetCache(mockCache)
  })

  it('should correctly handle batching and set isFinalBatch flag', async () => {
    const mockAuth = {
      getPluginRequestToken: jest.fn().mockResolvedValue('test-token'),
      getOwnServiceCredentials: jest.fn().mockResolvedValue({})
    }

    const mockCache = mockServices.cache.mock()
    const mockConfig = new ConfigReader({
      catalog: {
        webhook: {
          remoteEndpoint: 'https://example.com/webhook',
          secret: 'test-secret',
          intervalMinutes: 1,
          entityRequestSize: 4,
          entitySendSize: 2
        }
      }
    })

    const mockDiscovery: DiscoveryService = {
      getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007'),
      getExternalBaseUrl: jest.fn()
    }

    const mockLogger = mockServices.logger.mock()
    const mockScheduler = mockServices.scheduler.mock()

    const fetchMock = jest.fn().mockImplementation(url => {
      // Handle config endpoint
      if (url.includes('?config')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              resetCache: true,
              entityFilter: '[{"kind":"Component"}]'
            })
        })
      }
      // Handle webhook endpoint
      return Promise.resolve({ ok: true })
    })
    global.fetch = fetchMock

    const mockCatalogClient = {
      getEntities: jest
        .fn()
        .mockResolvedValueOnce({
          items: [
            { metadata: { uid: 'uid1', etag: 'new-etag1' } },
            { metadata: { uid: 'uid2', etag: 'new-etag2' } },
            { metadata: { uid: 'uid3', etag: 'new-etag3' } },
            { metadata: { uid: 'uid4', etag: 'new-etag4' } }
          ]
        })
        .mockResolvedValueOnce({ items: [] }) // Second call returns empty to simulate end of entities
    }
    ;(CatalogClient as jest.Mock).mockImplementation(() => mockCatalogClient)

    const processor = createWebhookHandler(
      mockAuth as unknown as AuthService,
      mockCache,
      mockConfig,
      mockDiscovery,
      mockLogger,
      mockScheduler
    )

    // Mock Date.now() to return a consistent timestamp
    const mockTimestamp = 1234567890
    jest.spyOn(Date, 'now').mockImplementation(() => mockTimestamp)

    await processor.processEntities(
      mockCatalogClient as unknown as CatalogClient,
      'https://example.com/webhook',
      'test-secret'
    )

    // Should have made 3 fetch calls (1 config + 2 entity batches)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // First call should be to config endpoint
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.com/webhook?config'
    )
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')

    // Second call (first batch) should not be final
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      batchId: mockTimestamp,
      entities: [
        { metadata: { uid: 'uid1', etag: 'new-etag1' } },
        { metadata: { uid: 'uid2', etag: 'new-etag2' } }
      ],
      isFinalBatch: false
    })

    // Third call (second batch) should be final since it's the last batch with entities
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      batchId: mockTimestamp,
      entities: [
        { metadata: { uid: 'uid3', etag: 'new-etag3' } },
        { metadata: { uid: 'uid4', etag: 'new-etag4' } }
      ],
      isFinalBatch: true
    })

    // Verify all batches use the same batchId
    const firstBatchId = JSON.parse(fetchMock.mock.calls[1][1].body).batchId
    const secondBatchId = JSON.parse(fetchMock.mock.calls[2][1].body).batchId
    expect(firstBatchId).toBe(secondBatchId)
    expect(firstBatchId).toBe(mockTimestamp)
  })

  it('should handle final batch correctly', async () => {
    const mockAuth = {
      getPluginRequestToken: jest.fn().mockResolvedValue('test-token'),
      getOwnServiceCredentials: jest.fn().mockResolvedValue({})
    }

    const mockCache = mockServices.cache.mock()
    const mockConfig = new ConfigReader({
      catalog: {
        webhook: {
          remoteEndpoint: 'https://example.com/webhook',
          secret: 'test-secret',
          intervalMinutes: 1,
          entityRequestSize: 2,
          entitySendSize: 2
        }
      }
    })

    const mockDiscovery: DiscoveryService = {
      getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007'),
      getExternalBaseUrl: jest.fn()
    }

    const mockLogger = mockServices.logger.mock()
    const mockScheduler = mockServices.scheduler.mock()

    const fetchMock = jest.fn().mockImplementation(url => {
      if (url.includes('?config')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              resetCache: true,
              entityFilter: '[{"kind":"Component"}]'
            })
        })
      }
      return Promise.resolve({ ok: true })
    })
    global.fetch = fetchMock

    const mockCatalogClient = {
      getEntities: jest
        .fn()
        .mockResolvedValueOnce({
          // First call returns exactly entityRequestSize items
          items: [
            { metadata: { uid: 'uid1', etag: 'new-etag1' } },
            { metadata: { uid: 'uid2', etag: 'new-etag2' } }
          ]
        })
        .mockResolvedValueOnce({ items: [] }) // Second call returns empty array
    }
    ;(CatalogClient as jest.Mock).mockImplementation(() => mockCatalogClient)

    const processor = createWebhookHandler(
      mockAuth as unknown as AuthService,
      mockCache,
      mockConfig,
      mockDiscovery,
      mockLogger,
      mockScheduler
    )

    const mockTimestamp = 1234567890
    jest.spyOn(Date, 'now').mockImplementation(() => mockTimestamp)

    await processor.processEntities(
      mockCatalogClient as unknown as CatalogClient,
      'https://example.com/webhook',
      'test-secret'
    )

    // Should have made 2 fetch calls (1 config + 1 entity batch)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // First call should be to config endpoint
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.com/webhook?config'
    )
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')

    // Second call should be final since it's the only batch with entities
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      batchId: mockTimestamp,
      entities: [
        { metadata: { uid: 'uid1', etag: 'new-etag1' } },
        { metadata: { uid: 'uid2', etag: 'new-etag2' } }
      ],
      isFinalBatch: true
    })
  })

  it('should reset cache when processing fails', async () => {
    const mockAuth = {
      getPluginRequestToken: jest.fn().mockResolvedValue('test-token'),
      getOwnServiceCredentials: jest.fn().mockResolvedValue({})
    }

    const mockCache = mockServices.cache.mock()
    const mockConfig = new ConfigReader({
      catalog: {
        webhook: {
          remoteEndpoint: 'https://example.com/webhook',
          secret: 'test-secret',
          intervalMinutes: 1
        }
      }
    })

    const mockDiscovery: DiscoveryService = {
      getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007'),
      getExternalBaseUrl: jest.fn()
    }

    const mockLogger = mockServices.logger.mock()
    const mockScheduler = mockServices.scheduler.mock()

    // Mock fetch to simulate a failure
    const fetchMock = jest.fn().mockImplementation(url => {
      if (url.includes('?config')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              resetCache: true,
              entityFilter: '[{"kind":"Component"}]'
            })
        })
      }
      return Promise.resolve({ ok: false, status: 500 })
    })
    global.fetch = fetchMock

    const mockCatalogClient = {
      getEntities: jest.fn().mockResolvedValue({
        items: [{ metadata: { uid: 'uid1', etag: 'etag1' } }]
      })
    }
    ;(CatalogClient as jest.Mock).mockImplementation(() => mockCatalogClient)

    const processor = createWebhookHandler(
      mockAuth as unknown as AuthService,
      mockCache,
      mockConfig,
      mockDiscovery,
      mockLogger,
      mockScheduler
    )

    await processor.processEntities(
      mockCatalogClient as unknown as CatalogClient,
      'https://example.com/webhook',
      'test-secret'
    )

    // Verify that the cache was reset
    expect(mockCache.delete).toHaveBeenCalledWith('catalog-webhook-etags')
  })
})
