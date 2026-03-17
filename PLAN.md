# Optimize data loading speed (targeting ~10x faster)

## Problem

Loading takes 5+ minutes even on fast connections. The bottleneck is **many sequential network requests** (one page at a time per table) and **slow in-memory assembly** of the family tree.

## Optimizations

### 1. Parallel page fetching within each table - DONE

- [x] Get row count first, then fetch all pages simultaneously
- [x] Waves of up to 8 concurrent pages per table
- [x] All 3 tables (individuals, families, family_members) fetched in parallel

### 2. Larger batch size (1000 → 5000 rows per page) - DONE

- [x] Fewer HTTP round-trips, less overhead
- [x] Batch size increased to 5000

### 3. Faster in-memory assembly - DONE

- [x] Direct mutation during assembly instead of copying objects
- [x] Cuts assembly time significantly for large trees

### 4. Leaner cache format - DONE

- [x] Compact array-based format for local cache
- [x] Reduces cache read/write time and storage size

### 5. Progress reporting stays intact - DONE

- [x] Loading progress updates as batches complete
- [x] Expected counts now shown alongside loaded counts

## Bulletproof Loading & Background Sync - DONE

### 6. Per-page retry with recovery

- [x] Each failed page retried individually (up to 4 attempts with backoff)
- [x] Failed pages get a second chance after the main wave completes
- [x] Partial data accepted gracefully — never lose rows we already fetched
- [x] Verification: loaded count compared against expected count with warnings

### 7. Background loading

- [x] Cache-first: cached data shown immediately, app usable instantly
- [x] Cloud sync happens in background (isBackgroundSyncing state)
- [x] Background sync never blocks the UI or search
- [x] Deduplication: only one background sync can run at a time
- [x] Search screen shows subtle "Syncing..." indicator during background sync
- [x] Loading progress bar with expected/loaded counts for first-time loads

### 8. Auto-retry on failure

- [x] First-time cloud loads retry up to 3 times with exponential backoff
- [x] If cloud fails but cache exists, user keeps using cache (no disruption)
- [x] Cache deserialization failures handled gracefully (clear bad cache, retry from cloud)
- [x] Query errors surface to UI without blocking app (isReady still set to true)

### 9. Timeout & resilience

- [x] Per-request timeout increased to 90s for large payloads
- [x] Table count query retried if first attempt fails
- [x] Sequential fallback if count is permanently unavailable (up to 5 consecutive errors tolerated)
