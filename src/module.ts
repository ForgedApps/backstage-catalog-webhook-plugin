import {
  coreServices,
  createBackendModule
} from '@backstage/backend-plugin-api'
import { createWebhookHandler } from './webhookHandler'

export const catalogWebhookPlugin = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'catalog-webhook',
  register(env) {
    env.registerInit({
      deps: {
        auth: coreServices.auth,
        cache: coreServices.cache,
        config: coreServices.rootConfig,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler
      },
      async init({ auth, cache, config, discovery, logger, scheduler }) {
        const webhookHandler = createWebhookHandler(
          auth,
          cache,
          config,
          discovery,
          logger,
          scheduler
        )
        await webhookHandler.start()
      }
    })
  }
})
