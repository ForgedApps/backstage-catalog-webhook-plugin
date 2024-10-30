import type {
	AuthService,
	DiscoveryService,
} from "@backstage/backend-plugin-api";
import { mockServices } from "@backstage/backend-test-utils";
import { CatalogClient } from "@backstage/catalog-client";
import { ConfigReader } from "@backstage/config";
import { cleanupCache } from "./cache";
import { createWebhookProcessor } from "./webhookProcessor";

jest.mock("@backstage/catalog-client");

describe("WebhookProcessor", () => {
	beforeEach(() => jest.useFakeTimers());

	it("should not start processing when remoteEndpoint is not configured", async () => {
		const mockConfig = new ConfigReader({});
		const mockLogger = mockServices.logger.mock();
		const mockCache = mockServices.cache.mock();
		const mockScheduler = mockServices.scheduler.mock();

		const processor = createWebhookProcessor(
			{} as AuthService,
			mockCache,
			mockConfig,
			{} as DiscoveryService,
			mockLogger,
			mockScheduler,
		);

		await processor.start();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			"Catalog webhook not configured, skipping",
		);
	});

	it("should start processing when properly configured", async () => {
		const mockAuth = {
			getPluginRequestToken: jest.fn().mockResolvedValue("test-token"),
			getOwnServiceCredentials: jest.fn().mockResolvedValue({}),
		};

		const mockCache = mockServices.cache.mock();

		const mockConfig = new ConfigReader({
			catalog: {
				webhook: {
					remoteEndpoint: "https://example.com/webhook",
					secret: "test-secret",
					intervalMinutes: 1,
				},
			},
		});

		const mockDiscovery: DiscoveryService = {
			getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007"),
			getExternalBaseUrl: jest.fn(),
		};

		const mockLogger = mockServices.logger.mock();

		const mockScheduler = mockServices.scheduler.mock();

		const mockCatalogClient = {
			getEntities: jest.fn().mockResolvedValue({
				items: [
					{ metadata: { uid: "uid1", etag: "etag1" } },
					{ metadata: { uid: "uid2", etag: "etag2" } },
				],
			}),
		};

		(CatalogClient as jest.Mock).mockImplementation(() => mockCatalogClient);

		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
		});

		const processor = createWebhookProcessor(
			mockAuth as unknown as AuthService,
			mockCache,
			mockConfig,
			mockDiscovery,
			mockLogger,
			mockScheduler,
		);

		await processor.start();

		expect(mockLogger.info).toHaveBeenCalledWith(
			"Catalog webhook started and reporting to https://example.com/webhook every 1 minute",
		);

		await processor.processEntities(
			mockCatalogClient as unknown as CatalogClient,
			"https://example.com/webhook",
			"test-secret",
		);

		expect(mockCatalogClient.getEntities).toHaveBeenCalled();
		expect(mockAuth.getPluginRequestToken).toHaveBeenCalled();
		expect(global.fetch).toHaveBeenCalledWith(
			"https://example.com/webhook",
			expect.any(Object),
		);

		await cleanupCache(mockCache);
	});
});
