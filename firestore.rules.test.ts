/**
 * Firestore Security Rules Verification Specification (Dirty Dozen TDD)
 */

export interface DirtyPayloadTest {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'delete' | 'list' | 'get';
  expectedResult: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_TESTS: DirtyPayloadTest[] = [
  {
    id: 1,
    name: 'Unauthenticated Write',
    collection: 'tabs',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { ownerId: 'anon', customerName: 'João', status: 'open' },
  },
  {
    id: 2,
    name: 'Unverified Email Spoof',
    collection: 'menuItems',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { ownerId: 'user_1', name: 'Litrão', category: 'cervejas', price: 18 },
  },
  {
    id: 3,
    name: 'Identity Spoofing (ownerId mismatch)',
    collection: 'tabs',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { ownerId: 'victim_uid', customerName: 'Fulano', status: 'open' },
  },
  {
    id: 4,
    name: 'Shadow Field Injection',
    collection: 'tabs',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { totalAmount: 0, isFree: true },
  },
  {
    id: 5,
    name: 'Orphaned TabItem Creation',
    collection: 'tabItems',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { ownerId: 'user_1', tabId: 'non_existent_tab', itemName: 'Litrão', quantity: 1 },
  },
  {
    id: 6,
    name: 'Closed Tab Mutation (Terminal State Bypass)',
    collection: 'tabs',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { totalAmount: 10 },
  },
  {
    id: 7,
    name: 'Adding Item to Closed Tab',
    collection: 'tabItems',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { ownerId: 'user_1', tabId: 'closed_tab_1', itemName: 'Litrão', quantity: 1 },
  },
  {
    id: 8,
    name: 'Cross-Tenant List Scraping',
    collection: 'tabs',
    operation: 'list',
    expectedResult: 'PERMISSION_DENIED',
    payload: { queryOwnerId: 'other_user' },
  },
  {
    id: 9,
    name: 'Value Poisoning on Update (Negative Quantity)',
    collection: 'tabItems',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { quantity: -5, totalPrice: -90 },
  },
  {
    id: 10,
    name: 'Denial-of-Wallet String Overflow',
    collection: 'tabs',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { customerName: 'A'.repeat(5000) },
  },
  {
    id: 11,
    name: 'Timestamp Forgery',
    collection: 'tabItems',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
  },
  {
    id: 12,
    name: 'Immutable Field Tampering (unitPrice modification)',
    collection: 'tabItems',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: { unitPrice: 0.01, totalPrice: 0.01 },
  },
];
