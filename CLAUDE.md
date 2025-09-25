# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Backstage backend plugin that periodically syncs catalog entities to a remote webhook endpoint. It's designed to keep external systems (like Atlassian Compass) in sync with your Backstage catalog by sending only changed entities using ETags for efficient change detection.

## Development Commands

- **Build**: `yarn build` - Uses Backstage CLI to compile the plugin
- **Test**: `yarn test` - Runs Jest tests through Backstage CLI
- **Lint**: `yarn lint` - Runs linting with Backstage CLI
- **Format**: Uses Biome for code formatting (configured in biome.json)
- **Start**: `yarn start` - Starts development mode
- **Release**: `yarn release` - Builds and publishes using release-it

## Architecture

### Core Components

**Module Registration** (`src/module.ts`):
- Registers as a Backstage backend module with pluginId 'catalog' and moduleId 'catalog-webhook'
- Depends on core services: auth, cache, config, discovery, logger, scheduler
- Creates and starts the webhook handler on initialization

**Webhook Handler** (`src/webhookHandler.ts`):
- Main logic for processing and sending catalog entities
- Uses scheduled tasks to periodically check for entity changes
- Implements ETag-based caching to minimize data transfer
- Supports entity filtering, batching, and remote configuration
- Signs payloads with HMAC-SHA256 when secret is configured

**Cache Management** (`src/cache.ts`):
- Stores entity ETags using Backstage's cache service
- Enables efficient change detection between runs
- Supports cache reset for full resync scenarios

### Key Features

- **Entity Filtering**: Supports allow-lists and complex entity filters
- **Batching**: Configurable batch sizes for requests and sends
- **Remote Configuration**: Can receive config from remote endpoint (filters, cache reset)
- **Security**: HMAC signature validation with configurable secret
- **Change Detection**: Uses ETags to send only modified entities

### Configuration Structure

The plugin reads configuration from `catalog.webhook` in app-config.yaml:
- `remoteEndpoint`: Target webhook URL (required)
- `intervalMinutes`: Check frequency (default: 10)
- `secret`: HMAC signing key (optional but recommended)
- `entityRequestSize`: Entities per Backstage request (default: 500)
- `entitySendSize`: Entities per webhook batch (default: 50)
- `allow`: Strict kind filtering array
- `entityFilter`: Additional entity filters

### Testing

The project uses Jest with Backstage test utilities. Tests are in `src/webhookHandler.test.ts`.

### TypeScript Configuration

- Uses Backstage CLI's base TypeScript config
- Source files in `src/` directory
- Output to `dist-types/` for type declarations