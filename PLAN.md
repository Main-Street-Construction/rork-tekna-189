# Optimize data loading speed (targeting ~10x faster)

## Problem

Loading takes 5+ minutes even on fast connections. The bottleneck is **many sequential network requests** (one page at a time per table) and **slow in-memory assembly** of the family tree.

## Optimizations

### 1. Parallel page fetching within each table

- Instead of fetching page 1, then page 2, then page 3 sequentially for each table — **get the row count first**, then fetch all pages of that table **simultaneously**
- Example: 5000 individuals = 5 pages fetched at the same time instead of one after another
- This alone could cut network time by 3–5x

### 2. Larger batch size (1000 → 5000 rows per page)

- Fewer HTTP round-trips means less overhead
- Each request carries more data but finishes in roughly the same time on a fast connection

### 3. Faster in-memory assembly

- Currently every family link creates a brand new copy of the person object — thousands of unnecessary copies
- Switch to direct mutation during assembly (safe because it's a one-time build step)
- This should cut assembly time significantly for large trees

### 4. Leaner cache format

- Use a compact array-based format for the local cache instead of full object keys
- Reduces cache read/write time and storage size by ~40%

### 5. Progress reporting stays intact

- Loading progress will still update as batches complete
- The user experience during loading remains the same, just much faster

