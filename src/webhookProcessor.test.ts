import type {
	AuthService,
	DiscoveryService,
} from "@backstage/backend-plugin-api";
import { mockServices } from "@backstage/backend-test-utils";
import { CatalogClient } from "@backstage/catalog-client";
import { ConfigReader } from "@backstage/config";
import { createWebhookProcessor } from "./webhookProcessor";

jest.mock("@backstage/catalog-client");

describe("WebhookProcessor", () => {
	beforeEach(() => jest.useFakeTimers());

	it("should not start processing when remoteEndpoint is not configured", async () => {
		const mockConfig = new ConfigReader({});
		const mockLogger = mockServices.logger.mock();

		const processor = createWebhookProcessor(
			mockLogger,
			mockConfig,
			{} as DiscoveryService,
			{} as AuthService,
		);

		await processor.start();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			"Catalog webhook not configured, skipping",
		);
	});

	it("should start processing when properly configured", async () => {
		const mockConfig = new ConfigReader({
			catalog: {
				webhook: {
					remoteEndpoint: "https://example.com/webhook",
					secret: "test-secret",
					intervalMinutes: 1,
				},
			},
		});

		const mockLogger = mockServices.logger.mock();

		const mockDiscovery: DiscoveryService = {
			getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007"),
			getExternalBaseUrl: jest.fn(),
		};

		const mockAuth = {
			getPluginRequestToken: jest.fn().mockResolvedValue("test-token"),
			getOwnServiceCredentials: jest.fn().mockResolvedValue({}),
		};

		const mockCatalogClient = {
			getEntities: jest.fn().mockResolvedValue({
				items: [
					{ metadata: { name: "entity1", etag: "etag1" } },
					{ metadata: { name: "entity2", etag: "etag2" } },
				],
			}),
		};

		(CatalogClient as jest.Mock).mockImplementation(() => mockCatalogClient);

		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
		});

		const processor = createWebhookProcessor(
			mockLogger,
			mockConfig,
			mockDiscovery,
			mockAuth as unknown as AuthService,
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
	});
});
