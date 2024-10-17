import { CatalogClient } from "@backstage/catalog-client";
import { initCache, saveCache } from "./cache";
import type {
	LoggerService,
	RootConfigService,
	DiscoveryService,
	AuthService,
} from "@backstage/backend-plugin-api";

export const createWebhookProcessor = (
	logger: LoggerService,
	config: RootConfigService,
	discovery: DiscoveryService,
	auth: AuthService,
) => {
	let isProcessing = false;

	const start = async (): Promise<void> => {
		const remoteEndpoint = config.getOptionalString(
			"catalog.webhook.remoteEndpoint",
		);

		if (!remoteEndpoint) {
			logger.warn("Catalog webhook not configured, skipping");
			return;
		}

		const secret = config.getOptionalString("catalog.webhook.secret");
		const interval =
			config.getOptionalNumber("catalog.webhook.intervalMinutes") || 10;

		const catalogClient = new CatalogClient({ discoveryApi: discovery });

		logger.info(
			`Catalog webhook started and reporting to ${remoteEndpoint} every ${interval} minute${
				interval > 1 ? "s" : ""
			}`,
		);

		setInterval(
			() => processEntities(catalogClient, remoteEndpoint, secret),
			interval * 60000,
		);
	};

	const processEntities = async (
		catalogClient: CatalogClient,
		remoteEndpoint: string,
		secret?: string,
	): Promise<void> => {
		if (isProcessing) {
			logger.info("Previous interval still processing, skipping this run");
			return;
		}

		isProcessing = true;

		try {
			// get Auth token for catalog request
			const token = await auth.getPluginRequestToken({
				onBehalfOf: await auth.getOwnServiceCredentials(),
				targetPluginId: "catalog",
			});

			if (!token) {
				logger.error("No token obtained from auth");
				return;
			}

			let tagCache = await initCache();

			const entities = [];
			const limit = 500;

			try {
				for (let offset = 0; ; offset += limit) {
					const { items } = await catalogClient.getEntities(
						{ limit, offset },
						token,
					);

					for (const item of items) {
						const {
							metadata: { name, etag },
						} = item;

						// check if the entity has changed since the last time we checked
						if (!etag || tagCache.get(name) !== etag) {
							entities.push(item);

							// update the cache with the new ETag
							if (etag) tagCache.set(name, etag);
						}
					}

					if (items.length < limit) break;
				}
			} catch (error) {
				logger.error(`Error fetching entities: ${error}`);
			}

			try {
				const response = await fetch(remoteEndpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						entities,
						secret,
					}),
				});

				if (!response.ok)
					throw Error(
						`Failed to post catalog to ${remoteEndpoint}: ${response.statusText}`,
					);

				await saveCache(tagCache);
				tagCache = new Map(); // free up memory
			} catch (error) {
				logger.error(`Error reporting to ${remoteEndpoint}: ${error}`);
			}
		} finally {
			isProcessing = false;
		}
	};

	return {
		start,
		processEntities, // Expose processEntities for testing
	};
};
