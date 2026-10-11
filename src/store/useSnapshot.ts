import { useSyncExternalStore } from 'react';
import type { Snapshot } from '../domain/types.js';
import type { Store } from './store.js';

export function useSnapshot(store: Pick<Store, 'subscribe' | 'getSnapshot'>): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
