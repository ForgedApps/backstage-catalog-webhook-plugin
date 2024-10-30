// The purpose of this file is to store a cache of entity etags in a file on disk.
// This is used to determine if each entity has changed since the last time we checked.

import {
	coreServices,
	type CacheService,
	createBackendPlugin,
} from "@backstage/backend-plugin-api";

export type EtagCache = Map<string, string>;

export const initCache = async (cache: CacheService): Promise<EtagCache> => {
	const cachedMap = await cache.get("etagMap");
	return new Map(Object.entries(cachedMap || {}));
};

export const saveCache = async (
	etagCache: EtagCache,
	cache: CacheService,
): Promise<void> => {
	const tagsObject = Object.fromEntries(etagCache);
	await cache.set("etagMap", tagsObject);
};

export const cleanupCache = async (cache: CacheService): Promise<void> => {
	await cache.delete("etagMap");
};
