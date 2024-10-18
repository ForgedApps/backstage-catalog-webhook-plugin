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

### Webhook Payload and Validation

The webhook payload will be sent as a POST request with the following structure:

```json
{
  "entities": [...]
}
```

### Validating Webhook Deliveries

If you've configured a secret key, the plugin will send a signature in the `X-Hub-Signature-256` header of each webhook request. This allows you to verify that the webhook payload was sent by your Backstage instance and hasn't been tampered with.

To validate the webhook delivery on your receiving server:

1. Extract the signature from the `X-Hub-Signature-256` header.
2. Compute the HMAC signature of the raw request body using your secret key.
3. Compare the computed signature with the one in the header.

Here's an example of how to validate the signature in Node.js:

```javascript
const crypto = require('crypto');

function validateWebhook(req, secret) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    throw new Error('No X-Hub-Signature-256 found on request');
  }

  const [algorithm, hash] = signature.split('=');
  if (algorithm !== 'sha256') {
    throw new Error('Unexpected hash algorithm');
  }

  const hmac = crypto.createHmac(algorithm, secret);
  const digest = hmac.update(req.body).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(digest))) {
    throw new Error('Request body digest did not match X-Hub-Signature-256');
  }

  // If we reach here, the signature is valid
  console.log('Webhook signature verified');
}
```

In this example, `req.body` should be the parsed JSON body of the request. Adjust this according to your server setup if needed.

Remember to use a constant-time comparison function (like `crypto.timingSafeEqual`) to prevent timing attacks.

Only process the webhook payload if the signature is valid. This ensures that the request came from your Backstage instance and wasn't tampered with in transit.

### Security Considerations

- Keep your secret key secure and don't expose it in your code or version control.
- Use HTTPS for your webhook endpoint to ensure the payload and headers are encrypted in transit.
- Regularly rotate your secret key as a best practice.

## Troubleshooting

If you encounter any issues:

1. Check the Backstage logs for any error messages related to the webhook plugin.
2. Ensure that the `remoteEndpoint` is correctly configured and accessible from your Backstage instance.
3. Verify that your Backstage instance has the necessary permissions to fetch catalog entities.
4. If using a secret, make sure it's correctly configured in both Backstage and the receiving server.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
