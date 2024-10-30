import {
	coreServices,
	createBackendModule,
} from "@backstage/backend-plugin-api";
import { createWebhookProcessor } from "./webhookProcessor";

export const catalogWebhookPlugin = createBackendModule({
	pluginId: "catalog",
	moduleId: "catalog-webhook",
	register(env) {
		env.registerInit({
			deps: {
				logger: coreServices.logger,
				cache: coreServices.cache,
				config: coreServices.rootConfig,
				discovery: coreServices.discovery,
				auth: coreServices.auth,
			},
			async init({ logger, cache, config, discovery, auth }) {
				const processor = createWebhookProcessor(
					logger,
					cache,
					config,
					discovery,
					auth,
				);
				await processor.start();
			},
		});
	},
});
