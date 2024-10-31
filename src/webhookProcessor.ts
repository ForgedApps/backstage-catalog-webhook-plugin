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
import { initCache, saveCache } from './cache'
import type { Entity } from '@backstage/catalog-model'

export const createWebhookProcessor = (
  auth: AuthService,
  cache: CacheService,
  config: RootConfigService,
  discovery: DiscoveryService,
  logger: LoggerService,
  scheduler: SchedulerService
) => {
  let isProcessing = false

  const start = async (): Promise<void> => {
    const remoteEndpoint = config.getOptionalString(
      'catalog.webhook.remoteEndpoint'
    )

    if (!remoteEndpoint) {
      logger.warn('Catalog webhook not configured, skipping')
      return
    }

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

      const batchSize =
        config.getOptionalNumber('catalog.webhook.batchSize') || 100
      let totalProcessed = 0
      let totalEntities = 0

      for (let offset = 0; ; offset += batchSize) {
        const entities: Entity[] = []

        try {
          const { items } = await catalogClient.getEntities(
            { limit: batchSize, offset },
            token
          )

          totalEntities += items.length

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

          if (entities.length > 0) {
            const payload = JSON.stringify({ entities })

            const headers: Record<string, string> = {
              'Content-Type': 'application/json'
            }

            if (secret) {
              const signature = crypto
                .createHmac('sha256', secret)
                .update(payload)
                .digest('hex')
              headers['x-hub-signature-256'] = `sha256=${signature}`
            }

            const response = await fetch(remoteEndpoint, {
              method: 'POST',
              headers,
              body: payload
            })

            if (!response.ok) {
              const body = response ? await response.text() : ''
              throw Error(
                `Failed to post catalog to remote endpoint: ${response.statusText} ${body}`
              )
            }

            totalProcessed += entities.length
          }

          if (items.length < batchSize) break
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
    processEntities // Expose processEntities for testing
  }
}
