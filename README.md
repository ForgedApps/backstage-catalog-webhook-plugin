# Catalog Webhook Plugin for Backstage

This plugin enables your Backstage instance to periodically send catalog entity updates to a remote endpoint. It's useful for keeping external systems in sync with your Backstage catalog.

## Features

- Periodically checks for changes in your Backstage catalog
- Sends updated entities to a configurable remote endpoint
- Uses ETags to efficiently track changes and minimize data transfer
- Supports a secret key for webhook payload validation
- Configurable update interval

## Installation

To install this plugin in your Backstage instance, follow these steps:

1. Install the plugin package in your Backstage backend:

   ```bash
   # From your Backstage root directory
   yarn add --cwd packages/backend @backstage/plugin-catalog-backend-module-catalog-webhook
   ```

2. Wire up the plugin to your backend:

   Edit your `packages/backend/src/index.ts` file and add the following:

   ```typescript
   import { catalogModuleCatalogWebhook } from '@backstage/plugin-catalog-backend-module-catalog-webhook';

   // In the backend builder configuration:
   backend.add(catalogModuleCatalogWebhook());
   ```

3. Configure the plugin in your `app-config.yaml`:

   ```yaml
   catalog:
     webhook:
       remoteEndpoint: 'https://your-remote-endpoint.com/webhook'
       intervalMinutes: 10  # Optional, defaults to 10 if not specified
       secret: 'your-secret-key'  # Optional, but recommended for security
   ```

   Replace `https://your-remote-endpoint.com/webhook` with the actual URL where you want to send catalog updates, and `your-secret-key` with a secure secret of your choice.

## Configuration

The plugin supports the following configuration options:

- `catalog.webhook.remoteEndpoint`: (Required) The URL of the remote endpoint where catalog updates will be sent.
- `catalog.webhook.intervalMinutes`: (Optional) The interval in minutes between each update check. Defaults to 10 minutes if not specified.
- `catalog.webhook.secret`: (Optional) A secret key that will be sent with the webhook payload for validation by the receiving server. If not provided, the webhook will function without a secret.

Note: While the secret is optional, it's strongly recommended for security purposes. When configured, it allows the receiving server to validate the authenticity of incoming webhook payloads.

## Usage

Once installed and configured, the plugin will automatically start sending catalog updates to the specified remote endpoint at the configured interval. No additional action is required.

The plugin will:

1. Fetch entities from your Backstage catalog
2. Check for changes since the last update using ETags
3. Send only the changed entities to the remote endpoint
4. Include the configured secret in the webhook payload for security (if provided)
5. Log information about its operations, including any errors encountered

### Webhook Payload

The webhook payload will be sent as a POST request with the following structure:

```json
{
  "entities": [...],
  "timestamp": "2023-04-20T12:34:56Z",
  "secret": "your-secret-key"
}
```

The receiving server should validate the secret before processing the payload.

## Troubleshooting

If you encounter any issues:

1. Check the Backstage logs for any error messages related to the webhook plugin.
2. Ensure that the `remoteEndpoint` is correctly configured and accessible from your Backstage instance.
3. Verify that your Backstage instance has the necessary permissions to fetch catalog entities.
4. If using a secret, make sure it's correctly configured in both Backstage and the receiving server.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
