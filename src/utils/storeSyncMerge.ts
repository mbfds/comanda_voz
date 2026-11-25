import { areCustomerNamesEquivalent } from './barCatalog';

export interface SyncStoreSnapshotLike {
  storeCode: string;
  storeName: string;
  catalogInitialized: boolean;
  autoArchivePaidAfter10Min?: boolean;
  menuItems: unknown[];
  tabs: unknown[];
  tabItems: unknown[];
  voiceOperators: unknown[];
  updatedAtMs: number;
}

export interface MergeStoreOptions {
  actionType?: 'add' | 'remove' | 'sync' | 'catalog';
  mutatedScopes?: Array<'tabs' | 'tabItems' | 'menuItems' | 'voiceOperators'>;
  removedTabItemIds?: string[];
  removedTabIds?: string[];
  removedMenuIds?: string[];
  removedOperatorIds?: string[];
  clearedAllMenu?: boolean;
}

interface GenericRecord {
  id?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
}

interface TabLike extends GenericRecord {
  id: string;
  customerName?: string;
  tableLabel?: string;
  status?: string;
  totalAmount?: number;
  paidAmount?: number;
  itemCount?: number;
  paymentMethod?: string;
}

interface TabItemLike extends GenericRecord {
  id: string;
  tabId?: string;
  customerName?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
}

export function extractTimestampMs(ts: unknown): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (ts && typeof ts === 'object') {
    const obj = ts as { _ms?: unknown; seconds?: unknown; nanoseconds?: unknown };
    if (typeof obj._ms === 'number' && Number.isFinite(obj._ms)) return obj._ms;
    if (typeof obj.seconds === 'number' && Number.isFinite(obj.seconds)) {
      const nanoMs =
        typeof obj.nanoseconds === 'number' && Number.isFinite(obj.nanoseconds)
          ? Math.floor(obj.nanoseconds / 1_000_000)
          : 0;
      return obj.seconds * 1000 + nanoMs;
    }
  }
  return 0;
}

function getRecordUpdatedMs(rec: GenericRecord): number {
  return Math.max(extractTimestampMs(rec.updatedAt), extractTimestampMs(rec.createdAt));
}

function toRecordArray<T extends GenericRecord>(arr: unknown): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (item): item is T =>
      Boolean(item && typeof item === 'object' && typeof (item as GenericRecord).id === 'string' && (item as GenericRecord).id!.length > 0)
  );
}

function unionRecordsById<T extends GenericRecord>(
  existingArr: T[],
  incomingArr: T[],
  preferIncomingOnEqualOrActive: boolean,
  removedIds?: Set<string>
): T[] {
  const merged = new Map<string, T>();

  for (const item of existingArr) {
    if (removedIds?.has(item.id!)) continue;
    merged.set(item.id!, { ...item });
  }

  for (const item of incomingArr) {
    if (removedIds?.has(item.id!)) continue;
    const prev = merged.get(item.id!);
    if (!prev) {
      merged.set(item.id!, { ...item });
      continue;
    }

    const prevMs = getRecordUpdatedMs(prev);
    const nextMs = getRecordUpdatedMs(item);
    if (nextMs > prevMs || (nextMs === prevMs && preferIncomingOnEqualOrActive)) {
      merged.set(item.id!, { ...prev, ...item });
    }
  }

  return Array.from(merged.values());
}

/**
 * Merges an incoming client snapshot against the authoritative server snapshot
 * so multiple phones/waiters on the same storeCode never overwrite each other's
 * concurrent launches, while keeping explicit ADM removals exact.
 */
export function mergeStoreSnapshots(
  current: SyncStoreSnapshotLike | undefined,
  incoming: {
    storeCode: string;
    storeName?: string;
    catalogInitialized?: boolean;
    autoArchivePaidAfter10Min?: boolean;
    menuItems?: unknown[];
    tabs?: unknown[];
    tabItems?: unknown[];
    voiceOperators?: unknown[];
    updatedAtMs?: number;
  },
  options: MergeStoreOptions = {}
): SyncStoreSnapshotLike {
  const actionType = options.actionType || 'add';
  const scopes = new Set(options.mutatedScopes || []);
  const hasExplicitScopes = scopes.size > 0;

  const removedTabItemSet = new Set(options.removedTabItemIds || []);
  const removedTabSet = new Set(options.removedTabIds || []);
  const removedMenuSet = new Set(options.removedMenuIds || []);
  const removedOperatorSet = new Set(options.removedOperatorIds || []);

  const currentMenu = toRecordArray<GenericRecord>(current?.menuItems);
  const incomingMenu = toRecordArray<GenericRecord>(incoming.menuItems);

  const currentOps = toRecordArray<GenericRecord>(current?.voiceOperators);
  const incomingOps = toRecordArray<GenericRecord>(incoming.voiceOperators);

  const currentTabs = toRecordArray<TabLike>(current?.tabs);
  const incomingTabs = toRecordArray<TabLike>(incoming.tabs);

  const currentTabItems = toRecordArray<TabItemLike>(current?.tabItems);
  const incomingTabItems = toRecordArray<TabItemLike>(incoming.tabItems);

  // 1. Merge menuItems
  let mergedMenu: GenericRecord[];
  const menuMutated = !hasExplicitScopes || scopes.has('menuItems');
  if (actionType === 'remove' && menuMutated) {
    if (options.clearedAllMenu) {
      mergedMenu = [];
    } else if (removedMenuSet.size > 0) {
      mergedMenu = unionRecordsById(currentMenu, incomingMenu, true, removedMenuSet);
    } else {
      mergedMenu = incomingMenu.length > 0 || !current ? [...incomingMenu] : [];
    }
  } else if (actionType === 'catalog' && menuMutated) {
    mergedMenu = unionRecordsById(currentMenu, incomingMenu, true);
  } else {
    mergedMenu = unionRecordsById(currentMenu, incomingMenu, menuMutated);
  }

  // 2. Merge voiceOperators
  let mergedOps: GenericRecord[];
  const opsMutated = !hasExplicitScopes || scopes.has('voiceOperators');
  if (actionType === 'remove' && opsMutated) {
    if (removedOperatorSet.size > 0) {
      mergedOps = unionRecordsById(currentOps, incomingOps, true, removedOperatorSet);
    } else {
      mergedOps = [...incomingOps];
    }
  } else {
    mergedOps = unionRecordsById(currentOps, incomingOps, opsMutated);
  }

  // 3. Merge tabItems (never drop items added concurrently by other phones)
  const itemsMutated = !hasExplicitScopes || scopes.has('tabItems');
  const mergedTabItems = unionRecordsById(
    currentTabItems,
    incomingTabItems,
    itemsMutated,
    actionType === 'remove' ? removedTabItemSet : undefined
  );

  // 4. Merge tabs & consolidate concurrent same-customer open tabs
  const tabsMutated = !hasExplicitScopes || scopes.has('tabs');
  const currentTabIdSet = new Set(currentTabs.map((t) => t.id));
  const mergedTabMap = new Map<string, TabLike>();

  for (const t of currentTabs) {
    mergedTabMap.set(t.id, { ...t });
  }

  for (const t of incomingTabs) {
    if (actionType === 'remove' && removedTabSet.has(t.id) && !mergedTabMap.has(t.id)) continue;
    const prev = mergedTabMap.get(t.id);
    if (!prev) {
      mergedTabMap.set(t.id, { ...t });
      continue;
    }

    const prevMs = getRecordUpdatedMs(prev);
    const nextMs = getRecordUpdatedMs(t);
    const prevPaid = Number(prev.paidAmount) || 0;
    const nextPaid = Number(t.paidAmount) || 0;
    const combinedPaid =
      actionType === 'remove' && tabsMutated ? nextPaid : Math.max(prevPaid, nextPaid);

    // Determine authoritative status without losing concurrent archive/closing/payment updates
    let nextStatus = prev.status || 'open';
    if (actionType === 'remove' && tabsMutated && (t.status === 'archived' || nextMs >= prevMs)) {
      nextStatus = t.status || nextStatus;
    } else if (prev.status === 'archived') {
      nextStatus = 'archived';
    } else if (t.status === 'archived' && tabsMutated) {
      nextStatus = 'archived';
    } else if (nextMs > prevMs || (nextMs === prevMs && tabsMutated)) {
      nextStatus = t.status || nextStatus;
    }

    const nextPaymentMethod =
      nextPaid >= prevPaid && typeof t.paymentMethod === 'string' && t.paymentMethod.trim()
        ? t.paymentMethod
        : (typeof prev.paymentMethod === 'string' && prev.paymentMethod.trim()
            ? prev.paymentMethod
            : t.paymentMethod) || '';

    mergedTabMap.set(t.id, {
      ...prev,
      ...(nextMs >= prevMs ? t : {}),
      id: prev.id,
      customerName:
        (typeof prev.customerName === 'string' && prev.customerName.trim()
          ? prev.customerName
          : t.customerName) || 'Cliente',
      tableLabel:
        (typeof t.tableLabel === 'string' && t.tableLabel.trim()
          ? t.tableLabel
          : prev.tableLabel) || '',
      status: nextStatus,
      paidAmount: combinedPaid,
      paymentMethod: nextPaymentMethod,
      createdAt:
        extractTimestampMs(prev.createdAt) > 0 &&
        (extractTimestampMs(t.createdAt) === 0 ||
          extractTimestampMs(prev.createdAt) <= extractTimestampMs(t.createdAt))
          ? prev.createdAt
          : t.createdAt || prev.createdAt,
      updatedAt: nextMs >= prevMs ? t.updatedAt || prev.updatedAt : prev.updatedAt,
    });
  }

  // Consolidate active customer tabs with phonetically equivalent names (except VENDA_AVULSA)
  // that may have been created concurrently on two phones before polling synced.
  const allMergedTabs = Array.from(mergedTabMap.values()).sort((a, b) => {
    const aWasServer = currentTabIdSet.has(a.id) ? 0 : 1;
    const bWasServer = currentTabIdSet.has(b.id) ? 0 : 1;
    if (aWasServer !== bWasServer) return aWasServer - bWasServer;
    return extractTimestampMs(a.createdAt) - extractTimestampMs(b.createdAt);
  });

  const canonicalTabs: TabLike[] = [];
  const remappedTabIdToCanonical = new Map<string, { id: string; customerName: string }>();

  for (const tab of allMergedTabs) {
    const isWalkIn = tab.tableLabel === 'VENDA_AVULSA';
    const isActiveTab = tab.status === 'open' || tab.status === 'closing';
    const custName = typeof tab.customerName === 'string' ? tab.customerName.trim() : '';

    if (!isWalkIn && isActiveTab && custName) {
      const match = canonicalTabs.find(
        (canon) =>
          canon.tableLabel !== 'VENDA_AVULSA' &&
          (canon.status === 'open' || canon.status === 'closing') &&
          typeof canon.customerName === 'string' &&
          areCustomerNamesEquivalent(canon.customerName, custName)
      );

      if (match) {
        remappedTabIdToCanonical.set(tab.id, {
          id: match.id,
          customerName: match.customerName || custName,
        });
        match.paidAmount = Number(
          ((Number(match.paidAmount) || 0) + (Number(tab.paidAmount) || 0)).toFixed(2)
        );
        if (!match.tableLabel && tab.tableLabel) {
          match.tableLabel = tab.tableLabel;
        }
        if (getRecordUpdatedMs(tab) > getRecordUpdatedMs(match)) {
          match.updatedAt = tab.updatedAt;
          if (match.status === 'open' && tab.status === 'closing') {
            match.status = 'closing';
          }
        }
        continue;
      }
    }

    canonicalTabs.push(tab);
  }

  // Remap any tabItems belonging to consolidated duplicate tabs
  const normalizedTabItems = mergedTabItems.map((item) => {
    const target = item.tabId ? remappedTabIdToCanonical.get(item.tabId) : undefined;
    if (!target) return item;
    return {
      ...item,
      tabId: target.id,
      customerName: target.customerName,
    };
  });

  // Group items by tabId & recalculate totalAmount / itemCount accurately
  const itemsByTabId = new Map<string, TabItemLike[]>();
  for (const item of normalizedTabItems) {
    if (!item.tabId) continue;
    const list = itemsByTabId.get(item.tabId) || [];
    list.push(item);
    itemsByTabId.set(item.tabId, list);
  }

  // If handleUndoLastLaunch deleted items from a tab created in that undo (`removedTabSet`),
  // only drop the tab if no concurrent items remain on it.
  const finalTabs = canonicalTabs
    .filter((tab) => {
      if (actionType === 'remove' && removedTabSet.has(tab.id)) {
        return (itemsByTabId.get(tab.id)?.length || 0) > 0;
      }
      return true;
    })
    .map((tab) => {
      const tabEntries = itemsByTabId.get(tab.id) || [];
      let nextTotal = Number(tab.totalAmount) || 0;
      let nextCount = Number(tab.itemCount) || 0;

      if (tabEntries.length > 0) {
        nextTotal = Number(
          tabEntries.reduce((acc, it) => acc + (Number(it.totalPrice) || 0), 0).toFixed(2)
        );
        nextCount = tabEntries.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
      } else if (
        tab.tableLabel !== 'VENDA_AVULSA' &&
        (actionType === 'remove' || itemsMutated)
      ) {
        nextTotal = 0;
        nextCount = 0;
      }

      const paid = Number(tab.paidAmount) || 0;
      let nextStatus = tab.status || 'open';
      if (tab.tableLabel === 'VENDA_AVULSA') {
        nextStatus = 'paid';
      } else if (nextStatus === 'paid' && Number((nextTotal - paid).toFixed(2)) > 0) {
        // Concurrent addition on a tab that was just marked paid reopens it automatically
        nextStatus = 'open';
      }

      return {
        ...tab,
        totalAmount: nextTotal,
        itemCount: nextCount,
        paidAmount: tab.tableLabel === 'VENDA_AVULSA' ? nextTotal : paid,
        status: nextStatus,
      };
    });

  finalTabs.sort((a, b) => getRecordUpdatedMs(b) - getRecordUpdatedMs(a));
  normalizedTabItems.sort(
    (a, b) => extractTimestampMs(b.createdAt) - extractTimestampMs(a.createdAt)
  );

  return {
    storeCode: incoming.storeCode,
    storeName:
      typeof incoming.storeName === 'string' && incoming.storeName.trim()
        ? incoming.storeName.trim().slice(0, 80)
        : current?.storeName || 'Bar & Comércio Central',
    catalogInitialized:
      typeof incoming.catalogInitialized === 'boolean'
        ? incoming.catalogInitialized
        : current?.catalogInitialized ?? true,
    autoArchivePaidAfter10Min:
      typeof incoming.autoArchivePaidAfter10Min === 'boolean'
        ? incoming.autoArchivePaidAfter10Min
        : current?.autoArchivePaidAfter10Min ?? false,
    menuItems: mergedMenu,
    tabs: finalTabs,
    tabItems: normalizedTabItems,
    voiceOperators: mergedOps,
    updatedAtMs: Date.now(),
  };
}
