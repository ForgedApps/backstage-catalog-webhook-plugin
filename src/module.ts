import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { createWebhookProcessor } from './webhookProcessor';

export const catalogModuleCatalogWebhook = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'catalog-webhook',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ logger, config, discovery, auth }) {
        const processor = createWebhookProcessor(
          logger,
          config,
          discovery,
          auth,
        );
        await processor.start();
      },
    });
  },
});
