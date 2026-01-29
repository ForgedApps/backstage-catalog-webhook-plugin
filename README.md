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
- Strict kind filtering through allow list configuration

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
   backend.add(import('@forgedapps/backstage-catalog-webhook-plugin'));
   ```

3. Configure the plugin in your `app-config.yaml`:

   ```yaml
   catalog:
     webhook:
       remoteEndpoint: 'https://your-remote-endpoint.com/webhook'
       intervalMinutes: 10  # Optional, defaults to 10 if not specified
       timeoutMinutes: 2  # Optional, defaults to 2 if not specified
       secret: 'your-secret-key'  # Optional, but recommended for security
       entityRequestSize: 500  # Optional, defaults to 500 if not specified
       entitySendSize: 50  # Optional, defaults to 50 if not specified
       allow: # Optional, strictly enforces which kinds can be processed
         - kind: ['api']
       entityFilter: # Optional, additional filters to apply
         - kind: ['Component', 'API']  # Filter by kind (OR)
         - metadata.namespace: ['my-namespace']  # Filter by namespace
   ```

4. Optionally, you can configure the remote webhook endpoint to respond to a `config` query parameter, which will allow it to send additional configuration to the plugin. This can be used to signal the plugin to reset its cache, apply filters before sending entities, or other behaviors in the future. The response should be a JSON object with the following properties:
   
   ```ts
   {
     "resetCache": boolean // (Optional) If true, will signal the plugin to clear its cache before sending entities.
     "entityFilter": EntityFilterQuery // (Optional) An array of entity filters (case-insensitive) to apply when retrieving entities from Backstage. This can be used to limit the entities that are retrieved from the catalog each interval.
   }
   ```
   See documentation for `EntityFilterQuery` [here](https://backstage.io/docs/reference/catalog-client.entityfilterquery/).
   
   The GET request `https://your-remote-endpoint.com/webhook?config` is sent to the remote endpoint once each interval prior to processing entities.

## Configuration

The plugin supports the following configuration options:

- `catalog.webhook.remoteEndpoint`: (Required) The URL of the remote endpoint where catalog updates will be sent.
- `catalog.webhook.intervalMinutes`: (Optional) The interval in minutes between each update check. Defaults to 10 minutes if not specified.
- `catalog.webhook.timeoutMinutes`: (Optional) The scheduler timeout in minutes for each processing run. Defaults to 2 minutes if not specified.
- `catalog.webhook.secret`: (Optional) A secret key that will be sent with the webhook payload for validation by the receiving server. If not provided, the webhook will function without a secret.
- `catalog.webhook.entityRequestSize`: (Optional) The number of entities to retrieve from Backstage per request. Defaults to 500 (max).
- `catalog.webhook.entitySendSize`: (Optional) The number of entities to send to the remote endpoint at any one time. This is an important number as payloads can grow too large for the remote server to handle due to the amount of data stored for each entity in Backstage. Defaults to 100.
- `catalog.webhook.allow`: (Optional) A list of entity kinds that are allowed to be processed. This acts as a strict filter - only entities of these kinds will be processed, regardless of any other filters. If not specified, all kinds are allowed.
- `catalog.webhook.entityFilter`: (Optional) An array of entity filters to apply when retrieving entities from Backstage. Note that multiple filters are considered OR, not AND. This can be used to limit the entities that are retrieved from the catalog each interval. This value is overridden by the `config.entityFilter` value if it is received from the remote endpoint.

Note: While the secret is optional, it's strongly recommended for security purposes. When configured, it allows the receiving server to validate the authenticity of incoming webhook payloads.

### Persistent Cache Configuration

By default, Backstage uses an in-memory cache that is lost on restart. To ensure the plugin's ETag cache persists across restarts (preventing unnecessary resends of all entities), configure Backstage to use a persistent cache backend.

Add the following to your `app-config.yaml` to use Redis as a persistent cache:

```yaml
backend:
  cache:
    store: redis
    connection: 'redis://localhost:6379'  # Adjust to your Redis connection string
```

Alternatively, you can use a file-based cache for development:

```yaml
backend:
  cache:
    store: memory
    # Note: file-based cache is not officially supported but can be configured
    # For production, Redis or another persistent cache backend is recommended
```

For more details on cache configuration options, see the [Backstage cache documentation](https://backstage.io/docs/backend-system/core-services/cache/).

## Usage

Once installed and configured, the plugin will automatically start sending catalog updates to the specified remote endpoint at the configured interval. No additional action is required.

The plugin will:

1. Fetch entities from your Backstage catalog (respecting allowed kinds if configured)
2. Check for changes since the last update using ETags
3. Send only the changed entities to the remote endpoint
4. Include the configured secret in the webhook payload for security (if provided)
5. Log information about its operations, including any errors encountered

### Filtering Entities

The plugin provides multiple layers of filtering:

1. **Kind Filtering (allow list)**: This is the most restrictive filter and is applied first. If configured, only entities of the specified kinds will be processed, regardless of any other filters, including kind filters in entityFilter.

   ```yaml
   catalog:
     webhook:
       allow:
         - kind: ['component', 'api', 'system'] # Restrict to these kinds only, cannot be bypassed
   ```

2. **Additional Filters (entityFilter)**: These filters are applied after the kind filter. You can use any valid Backstage filter here, including kind filters (though these will be further restricted by allowed kinds if it's configured).

   ```yaml
   catalog:
     webhook:
       allow:
         - kind: ['component', 'api', 'system']
       entityFilter:
         - kind: ['Component', 'Location']  # Restrict to these kinds, can be bypassed by remote filters
         - metadata.namespace: ['my-namespace'] # Note this is OR, so it will return in addition to kind matches
   ```

   In this example:
   - First, only Components, APIs, and Systems are allowed (due to allow list)
   - Then, filtering ensures only components, locations or entities in 'my-namespace' will be processed
   - However, Locations are not allowed so they will not be included

3. **Remote Filters**: Any filters received from the remote endpoint are combined with the above filters, with allowed kinds still being the most restrictive.

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
