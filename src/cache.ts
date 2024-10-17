// The purpose of this file is to store a cache of entity etags in a file on disk.
// This is used to determine if each entity has changed since the last time we checked.

import storage from 'node-persist';

export type EtagCache = Map<string, string>;

export const initCache = async (): Promise<EtagCache> => {
  await storage.init({ dir: 'etagCache' });

  // Load the cached map from disk if it exists
  const cachedMap = await storage.getItem('etagMap');
  return new Map(Object.entries(cachedMap || {}));
};

export const saveCache = async (etagCache: EtagCache): Promise<void> => {
  // Serialize the map as an object and store it back to disk
  const tagsObject = Object.fromEntries(etagCache);
  await storage.setItem('etagMap', tagsObject);
};
