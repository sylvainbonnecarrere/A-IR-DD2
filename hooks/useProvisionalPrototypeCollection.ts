import { useState } from 'react';
import { RobotId } from '../types';

type ProvisionalPrototypeRecord = {
  id: string;
  creator_id: RobotId;
  created_at: string;
  updated_at: string;
};

type ProvisionalPrototypeInput<T extends ProvisionalPrototypeRecord> = Omit<
  T,
  'id' | 'creator_id' | 'created_at' | 'updated_at'
>;

type UseProvisionalPrototypeCollectionOptions<T extends ProvisionalPrototypeRecord> = {
  prefix: string;
  creatorId: RobotId;
  initialItems?: T[];
};

const collectionIdCounters = new Map<string, number>();

function createCollectionItemId(prefix: string): string {
  const nextCounter = (collectionIdCounters.get(prefix) ?? 0) + 1;
  collectionIdCounters.set(prefix, nextCounter);

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${nextCounter}`;
}

export function useProvisionalPrototypeCollection<T extends ProvisionalPrototypeRecord>({
  prefix,
  creatorId,
  initialItems = [],
}: UseProvisionalPrototypeCollectionOptions<T>) {
  const [items, setItems] = useState<T[]>(initialItems);

  const addItem = (item: ProvisionalPrototypeInput<T>) => {
    const timestamp = new Date().toISOString();
    const nextItem = {
      ...item,
      id: createCollectionItemId(prefix),
      creator_id: creatorId,
      created_at: timestamp,
      updated_at: timestamp,
    } as T;

    setItems((previousItems) => [...previousItems, nextItem]);

    return { success: true as const, itemId: nextItem.id };
  };

  const deleteItem = (id: string) => {
    setItems((previousItems) => previousItems.filter((item) => item.id !== id));
    return { success: true as const };
  };

  return {
    items,
    addItem,
    deleteItem,
  };
}