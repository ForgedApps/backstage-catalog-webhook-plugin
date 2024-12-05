# Catalog Webhook Plugin for Backstage

This plugin enables your Backstage instance to periodically send catalog entity updates to a remote endpoint. It's useful for keeping external systems in sync with your Backstage catalog.

This plugin has been reviewed by Spotify and listed at [https://backstage.io/plugins](https://backstage.io/plugins).

## Features

- Periodically checks for changes in your Backstage catalog
- Sends updated entities to a configurable remote endpoint
- Uses ETags to efficiently track changes and minimize data transfer
- Supports a secret key for webhook payload validation
- Configurable update interval and entity request/send size
- Ability to filter entities before Backstage catalog is queried
- Cache reset functionality to force a full resync of all entities

## Installation

To install this plugin in your Backstage instance, follow these steps:

1. Install the plugin package in your Backstage backend:

   ###### From your Backstage root directory:
   ```bash   
   yarn --cwd packages/backend add @forgedapps/backstage-catalog-webhook-plugin
   ```

2. Wire up the plugin to your backend:

   Edit your `packages/backend/src/index.ts` file and add the following:

   ```typescript
   import { catalogWebhookPlugin } from '@forgedapps/backstage-catalog-webhook-plugin';

   // In the backend builder configuration:
   backend.add(catalogWebhookPlugin());
   ```

3. Configure the plugin in your `app-config.yaml`:

   ```yaml
   catalog:
     webhook:
       remoteEndpoint: 'https://your-remote-endpoint.com/webhook'
       intervalMinutes: 10  # Optional, defaults to 10 if not specified
       secret: 'your-secret-key'  # Optional, but recommended for security
       entityRequestSize: 500  # Optional, defaults to 500 if not specified
       entitySendSize: 50  # Optional, defaults to 50 if not specified
       entityFilter: # Optional, defaults to all entities if not specified
         - kind: ['Component', 'API'] # OR...
         - metadata.name: ['my-component', 'my-api']
   ```

4. Optionally, you can configure the remote webhook endpoint to respond to a `config` query parameter, which will allow it to send additional configuration to the plugin. This can be used to signal the plugin to reset its cache, apply filters before sending entities, or other behaviors in the future. The response should be a JSON object with the following properties:
   
   ```ts
   {
     "resetCache": boolean // (Optional) If true, will signal the plugin to clear its cache before sending entities.
     "entityFilter": EntityFilterQuery // (Optional) An array of entity filters to apply when retrieving entities from Backstage. This can be used to limit the entities that are retrieved from the catalog each interval.
   }
   ```
   
   The GET request `https://your-remote-endpoint.com/webhook?config` is sent to the remote endpoint once each interval prior to processing entities.

## Configuration

The plugin supports the following configuration options:

- `catalog.webhook.remoteEndpoint`: (Required) The URL of the remote endpoint where catalog updates will be sent.
- `catalog.webhook.intervalMinutes`: (Optional) The interval in minutes between each update check. Defaults to 10 minutes if not specified.
- `catalog.webhook.secret`: (Optional) A secret key that will be sent with the webhook payload for validation by the receiving server. If not provided, the webhook will function without a secret.
- `catalog.webhook.entityRequestSize`: (Optional) The number of entities to retrieve from Backstage per request. Defaults to 500 (max).
- `catalog.webhook.entitySendSize`: (Optional) The number of entities to send to the remote endpoint at any one time. This is an important number as payloads can grow too large for the remote server to handle due to the amount of data stored for each entity in Backstage. Defaults to 100.
- `catalog.webhook.entityFilter`: (Optional) An array of entity filters to apply when retrieving entities from Backstage. Note that multiple filters are considered OR, not AND. This can be used to limit the entities that are retrieved from the catalog each interval. This value is overridden by the `config.entityFilter` value if it is received from the remote endpoint.

Note: While the secret is optional, it's strongly recommended for security purposes. When configured, it allows the receiving server to validate the authenticity of incoming webhook payloads.

## Usage

Once installed and configured, the plugin will automatically start sending catalog updates to the specified remote endpoint at the configured interval. No additional action is required.

The plugin will:

1. Fetch entities from your Backstage catalog
2. Check for changes since the last update using ETags
3. Send only the changed entities to the remote endpoint
4. Include the configured secret in the webhook payload for security (if provided)
5. Log information about its operations, including any errors encountered

### Cache Reset Functionality

The plugin includes a cache reset feature that can be triggered by the remote server. This is useful for troubleshooting scenarios where you need to force a full resync of all entities without restarting your Backstage instance.

Before checking Backstage for changed entities, it makes a request to the webhook endpoint with the `resetCache` query parameter. If the remote server responds with `true`, the plugin will clear its internal cache before the run, sending all entities rather than only those that have changed.

This feature is particularly helpful when:
- The remote system has lost sync with Backstage
- You need to rebuild the remote system's data
- You're debugging entity synchronization issues

### Webhook Payload and Validation

The webhook payload will be sent as a POST request with the following structure:

```json
{
  "batchId": // Date.now() when the batch started processing, consistent until isFinalBatch is true,
  "entities": // [...Backstage entities]
  "isFinalBatch": // true when all entities have been sent, false otherwise
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
5. If you're experiencing payload size errors, try reducing the `entitySendSize` variable.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
