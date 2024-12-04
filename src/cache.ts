// The purpose of this file is to store a cache of entity etags in a file on disk.
// This is used to determine if each entity has changed since the last time we checked.

import type { CacheService } from '@backstage/backend-plugin-api'

export type EtagCache = Map<string, string>

const CACHE_KEY = 'catalog-webhook-etags'

export const initCache = async (
  cache: CacheService
): Promise<Map<string, string>> => {
  const stored = await cache.get<Record<string, string>>(CACHE_KEY)
  return new Map(stored ? Object.entries(stored) : [])
}

export const saveCache = async (
  tagCache: Map<string, string>,
  cache: CacheService
): Promise<void> => {
  await cache.set(CACHE_KEY, Object.fromEntries(tagCache))
}

export const resetCache = async (cache: CacheService): Promise<void> => {
  await cache.delete(CACHE_KEY)
}
