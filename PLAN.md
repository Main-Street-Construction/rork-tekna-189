# Optimize data loading speed

**What changes:**

- [x] **Fetch all three data tables at the same time** instead of one after another — this alone should cut load time by roughly 60%
- [x] **Increase batch size from 500 to 1000** rows per request — safe for text-only data, means fewer round trips
- [x] **Remove the artificial 50ms pause** between batches — unnecessary for lightweight text
- [x] **Request only the columns actually used** instead of everything (`select('*')`) — smaller responses, faster transfers
- [x] **Update the progress indicator** to reflect parallel loading (shows all three progressing simultaneously)

**Expected impact:**

- Initial load should be ~2–3× faster
- Background syncs will also benefit
- No changes to how data is stored, displayed, or used — purely a speed improvement

