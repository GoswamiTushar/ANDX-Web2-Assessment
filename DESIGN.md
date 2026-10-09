# System Scaling & Architecture Design (500M Snapshots/Day)

### Scale & Data Profile
- **Throughput:** 5,800 writes/sec average; 60,000 writes/sec peak.
- **Rows per Day:** 500 million snapshot rows.
- **Bytes per Day:** At ~120 bytes per row plus index overhead, raw table storage grows ~60 GB/day uncompressed (~15 GB compressed). WAL write volume generates ~120 GB/day.

### What Breaks First
A single-node PostgreSQL instance saturates. At 60,000 writes/sec, simultaneous B-Tree index updates on `idx_snapshots_topclips` and write-amplification on `aggregator.snapshots` saturate disk IOPS and memory buffer pools. WAL `fsync` stalls cause backend lock contention, backing up Redpanda consumer queues until the aggregator exceeds its Kafka session timeout and rebalances uncontrollably.

### Metrics to Alert On
1. **Redpanda Consumer Lag:** `kafka_consumergroup_lag{group="aggregator-group"} > 50,000` (alerting on sustained queue backlog growth).
2. **Disk IOPS & Await Time:** `node_disk_write_time_seconds / node_disk_writes_completed > 15ms` (alerting on storage saturation).
3. **PostgreSQL WAL / Lock Bottlenecks:** `pg_stat_activity` with `wait_event_type IN ('IO', 'WALWrite', 'Lock') > 10 backends`.
4. **Ingestion Lag Monitor:** `gateway_event_loop_lag_ms > 100ms` and `http_requests_total{status=~"429|503"}` spike.

### Proposed Architecture Changes
1. **Time-Based Partitioning:** Partition `aggregator.snapshots` daily (`PARTITION BY RANGE (observed_at)`). Keeps active B-tree indexes fit inside working RAM and enables zero-cost truncation of historic days via `DROP PARTITION`.
2. **Hash-Distributed Partitioning by `clip_id`:** Shard `snapshots` and `clip_state` horizontally across 8 PostgreSQL/Citus instances using consistent hashing on `clip_id`.
3. **In-Memory Windowed Coalescing:** Buffer incoming snapshots in Redis or an aggregator memory buffer over 5-second tumbling windows. Only persist the highest/latest observation per clip per window, cutting database writes by 70–80% during intense viral bursts without violating end-of-campaign correctness.
