# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Authentication & Verification Gate**: Every read and write operation requires a signed-in user (`request.auth != null`), and all write operations require a verified email (`request.auth.token.email_verified == true`).
2. **Tenant Isolation (`ownerId`)**: Every `MenuItem`, `BarTab`, and `TabItem` belongs strictly to `request.auth.uid`. Users can never read, list, create, update, or delete records owned by another `ownerId`.
3. **Master Gate Relational Integrity (`TabItem` -> `BarTab`)**: A `TabItem` cannot be created, updated, or deleted unless its parent `BarTab` (`/tabs/$(tabId)`) exists, is owned by `request.auth.uid`, and currently has `status == 'open'`.
4. **Terminal State Locking (`BarTab.status`)**: Once a `BarTab` transitions to `status == 'closed'`, it is locked in a terminal state and cannot be modified or have new items added/removed.
5. **Temporal Integrity**: `createdAt` must equal `request.time` on creation and remain strictly immutable on update. `updatedAt` must equal `request.time` on every create and update.
6. **Strict Schema & Volumetric Boundaries**: No shadow fields are permitted (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update). All strings and numbers are strictly bounded by length and value limits.

## 2. The "Dirty Dozen" Payloads

1. **Unauthenticated Write**: Creating a `BarTab` with `request.auth == null`.
2. **Unverified Email Spoof**: Creating a `MenuItem` with `email_verified: false`.
3. **Identity Spoofing (`ownerId` Mismatch)**: Creating a `BarTab` where `ownerId` is set to another user's UID.
4. **Shadow Field Injection**: Updating a `BarTab` with an undeclared field `isFree: true`.
5. **Orphaned TabItem Creation**: Creating a `TabItem` referencing a non-existent `tabId`.
6. **Closed Tab Mutation (Terminal State Bypass)**: Updating `totalAmount` on a `BarTab` whose `existing().status == 'closed'`.
7. **Adding Item to Closed Tab**: Creating a `TabItem` whose parent `BarTab` has `status == 'closed'`.
8. **Cross-Tenant List Scraping**: Listing `/tabs` without filtering by `ownerId == request.auth.uid`.
9. **Value Poisoning on Update**: Updating `TabItem.quantity` to `-5` or a string `"many"`.
10. **Denial-of-Wallet String Overflow**: Creating a `BarTab` with a 5,000-character `customerName` or a 500-character `tabId`.
11. **Timestamp Forgery**: Creating a `TabItem` with a client-supplied past `createdAt` timestamp (`createdAt != request.time`).
12. **Immutable Field Tampering**: Updating `TabItem.unitPrice` or `TabItem.voiceTranscript` after creation.
