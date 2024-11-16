import crypto from 'node:crypto'
import type {
  AuthService,
  CacheService,
  DiscoveryService,
  LoggerService,
  RootConfigService,
  SchedulerService
} from '@backstage/backend-plugin-api'
import { CatalogClient } from '@backstage/catalog-client'
import type { Entity } from '@backstage/catalog-model'
import { initCache, resetCache, saveCache } from './cache'

export const createWebhookProcessor = (
  auth: AuthService,
  cache: CacheService,
  config: RootConfigService,
  discovery: DiscoveryService,
  logger: LoggerService,
  scheduler: SchedulerService
) => {
  let isProcessing = false

  const sendWebhookRequest = async (
    remoteEndpoint: string,
    payload: {
      batchId: number
      entities: Entity[]
      isFinalBatch: boolean
    },
    secret?: string
  ): Promise<void> => {
    const payloadString = JSON.stringify(payload)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (secret) {
      const signature = crypto
        .createHmac('sha256', secret)
        .update(payloadString)
        .digest('hex')
      headers['x-hub-signature-256'] = `sha256=${signature}`
    }

    const response = await fetch(remoteEndpoint, {
      method: 'POST',
      headers,
      body: payloadString
    })

    if (!response.ok) {
      const body = response ? await response.text() : ''
      throw Error(
        `Failed to post catalog to remote endpoint: ${response.statusText} ${body}`
      )
    }
  }

  const start = async (): Promise<void> => {
    let remoteEndpoint = config.getOptionalString(
      'catalog.webhook.remoteEndpoint'
    )

    if (!remoteEndpoint) {
      logger.warn('Catalog webhook not configured, skipping')
      return
    }

    if (remoteEndpoint.endsWith('/'))
      remoteEndpoint = remoteEndpoint.slice(0, -1)

    const secret = config.getOptionalString('catalog.webhook.secret')
    const minutes =
      config.getOptionalNumber('catalog.webhook.intervalMinutes') || 10

    const catalogClient = new CatalogClient({ discoveryApi: discovery })

    logger.info(
      `Catalog webhook started and reporting to ${remoteEndpoint} every ${minutes} minute${
        minutes > 1 ? 's' : ''
      }`
    )

    await scheduler.scheduleTask({
      frequency: { minutes },
      timeout: { seconds: 30 },
      id: 'process-entities',
      fn: async () =>
        await processEntities(catalogClient, remoteEndpoint, secret)
    })
  }

  const checkCacheReset = async (
    remoteEndpoint: string,
    logger: LoggerService,
    secret?: string
  ): Promise<void> => {
    try {
      const response = await fetch(`${remoteEndpoint}?resetCache`, {
        method: 'GET',
        headers: secret
          ? {
              'x-hub-signature-256': `sha256=${crypto
                .createHmac('sha256', secret)
                .update('')
                .digest('hex')}`
            }
          : {}
      })

      if (response.ok) {
        const shouldReset = await response.json()
        console.log('shouldReset:', shouldReset)
        if (shouldReset) {
          logger.info('Received cache reset signal, clearing local cache')
          await resetCache(cache)
        }
        return shouldReset
      }

      logger.warn(`Failed to check cache reset status: ${response.statusText}`)
    } catch (error) {
      logger.warn(`Error checking cache reset status: ${error}`)
    }
  }

  const processEntities = async (
    catalogClient: CatalogClient,
    remoteEndpoint: string,
    secret?: string
  ): Promise<void> => {
    if (isProcessing) {
      logger.info('Previous interval still processing, skipping this run')
      return
    }

    isProcessing = true

    try {
      // Check for signal to clear cache
      await checkCacheReset(remoteEndpoint, logger, secret)

      // get Auth token for catalog request
      const token = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog'
      })

      if (!token) {
        logger.error('No token obtained from auth')
        return
      }

      // load cache into memory for processing
      let tagCache = await initCache(cache)

      const entityRequestSize =
        config.getOptionalNumber('catalog.webhook.entityRequestSize') || 500
      const entitySendSize =
        config.getOptionalNumber('catalog.webhook.entitySendSize') || 100
      let totalProcessed = 0
      let totalEntities = 0

      for (let offset = 0; ; offset += entityRequestSize) {
        try {
          const { items } = await catalogClient.getEntities(
            { limit: entityRequestSize, offset },
            token
          )

          totalEntities += items.length

          const entities: Entity[] = []
          for (const item of items) {
            const {
              metadata: { uid, etag }
            } = item

            if (!uid) continue

            // check if the entity has changed since the last time we checked
            if (!etag || tagCache.get(uid) !== etag) {
              entities.push(item)

              // update the cache with the new ETag
              if (etag) tagCache.set(uid, etag)
            }
          }

          // Send batches of changed entities
          for (let i = 0; i < entities.length; i += entitySendSize) {
            const batchId = Date.now()
            const batch = entities.slice(i, i + entitySendSize)
            const isLastBatch = i + entitySendSize >= entities.length
            const isFinalBatch = items.length < entityRequestSize && isLastBatch

            await sendWebhookRequest(
              remoteEndpoint,
              {
                batchId,
                entities: batch,
                isFinalBatch
              },
              secret
            )

            totalProcessed += batch.length
          }

          if (items.length < entityRequestSize) break
        } catch (error) {
          logger.error(`Error processing entities: ${error}`)
          break
        }
      }

      await saveCache(tagCache, cache)
      tagCache = new Map() // free up memory
      logger.info(
        `Catalog webhook processed ${totalProcessed} changed out of ${totalEntities} entities`
      )
    } catch (error) {
      logger.error(`Error in processEntities: ${error}`)
    } finally {
      isProcessing = false
    }
  }

  return {
    start,
    processEntities
  }
}
