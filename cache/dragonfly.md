# Dragonfly: The Modern In-Memory Data Store (Deep Dive)

DragonflyDB is founded by Roman Gershman (ex-AWS ElastiCache Principal Engineer) with a single goal: addressing the inherent architectural limitations of Redis to build "The Fastest In-Memory Data Store."

---

## 1. Core Architecture: Shared-Nothing & Multi-Threading

Unlike Redis, which is fundamentally single-threaded (with some multi-threaded I/O in v6+), Dragonfly is built from the ground up to leverage modern multi-core hardware.

### Shared-Nothing Design
- **Dataset Partitioning:** The dataset is split into **N shards**, where `N` is the number of **Logical Cores** (Hardware Threads).
    - *Example:* On a **4 Core / 8 Thread** server, Dragonfly will create **8 shards** (N=8).
- **Independent Ownership:** Each shard is exclusively managed by a single, dedicated thread.
- **CPU Affinity (Pinning):** Dragonfly pins each thread to a specific logical core to avoid the overhead of OS scheduling (threads bouncing between cores).
- **No Lock Contention:** Since a thread has exclusive ownership of its shard, it doesn't need locks (mutexes) to process commands, avoiding the "Lock Contention" bottleneck found in traditional multi-threaded systems.

### Inter-Thread Communication (Message Bus)
- Threads communicate via a **Message Bus** (conceptually similar to Go Channels).
- If a client connects to Thread A but wants data in Shard B (owned by Thread B), Thread A sends a message to Thread B via the bus to process the request.

---

## 2. Scaling Strategy: Vertical-First

Dragonfly focuses on **Vertical Scaling** (scaling up on a single node) before Horizontal Scaling (Cluster).

### Why Vertical first? (Root Square Law)
- Hardware efficiency: A single large server (Vertical) is often ~20-30% more hardware-cost-efficient than a cluster of smaller servers (Horizontal) with equivalent total capacity.
- Operational Simplicity: No cluster management, no Sentinels, and no expensive cross-node slot migrations until truly necessary.

---

## 3. "Cutting Edge" Algorithms & Data Structures

Dragonfly replaces legacy Redis algorithms with modern alternatives:

### VLL (Very Lightweight Locking) Protocol
- Used for **Atomic Transactions** across multiple shards.
- More advanced and robust than Redis’s `MULTI/EXEC` (which doesn't rollback on individual command failure).

### 2Q Eviction Policy
- Redis uses an **Approximated LRU** (Least Recently Used), which struggles with "Long Tail" access patterns.
- Dragonfly uses **2Q**, which tracks both **Recency** and **Frequency** to make better decisions on which keys to evict.

### DashTable
- Dragonfly uses **DashTable** for its primary (key, value) storage.
- It consumes **~50% less memory** than Redis's standard HashTable (chaining method) and offers better CPU cache locality.

---

## 4. Resharding & Scaling (Redis vs Dragonfly)

### 4.1 Redis Scaling: Slot Migration
Redis Cluster uses **16384 hash slots**.
- **Mechanism:** Migration happens **slot-by-slot**. The cluster must explicitly move each key in a slot over the network from one node's memory to another's.
- **The Cost:** Since Redis is single-threaded, it must balance migration work with command processing. This is **explicit and operationally heavy**.

### 4.2 Dragonfly Scaling: Multi-Threaded streaming
Dragonfly handles data redistribution much better due to its **Multi-threaded Shared-Nothing architecture**:

#### A. Vertical Resharding (Within 1 Node)
- When shifting core counts (e.g., from 4 to 8 threads on one machine), Dragonfly performs an **In-Process Redistribution** during boot.
- Since it's all within the same RAM space, keys are instantly re-mapped to the new shards/threads. No network cost.

#### B. Horizontal Resharding (Swarm Mode)
- **Parallel Streaming:** Unlike Redis (single-core migration), Dragonfly uses **multiple threads** to stream shards in parallel.
- **Thread-to-Thread Migration:** Source threads stream their local shards directly to destination threads via multiple parallel TCP connections.
- **Efficiency:** This makes resharding **orders of magnitude faster** and reduces the "latency stall" period common in Redis clusters.

---

## 5. Data Persistence & Durability

How does Dragonfly ensure data isn't lost when the server goes down?

### Snapshotting (RDB Compatible)
- Dragonfly supports the **Redis RDB format**, allowing you to save your in-memory state to a local disk file (typically an SSD/NVMe for speed).
- **Multi-threaded Saving:** Unlike Redis (which uses `fork()` and a single-process `BGSAVE`), Dragonfly leverages all its threads to save shards **in parallel**.
- **Performance:** This parallel approach makes snapshotting significantly faster and reduces the duration of "copy-on-write" memory overhead during the save process.

### Replication
- For higher reliability, you can set up **Master-Replica** replication. If the main server crashes, the replica has a copy of the data ready to take over.

---

## 6. Comparison: Redis vs Dragonfly

| Feature | Redis | Dragonfly |
| :--- | :--- | :--- |
| **Threading** | Single-threaded core | Multi-threaded (Shared-nothing) |
| **Persistence** | Single-threaded (fork) | Multi-threaded (Parallel) |
| **Resharding** | Slot-by-slot (Network) | Multi-threaded streaming (Parallel) |
| **Scaling** | Horizontal (Cluster) first | Vertical (Core) first |
| **Eviction** | Approx. LRU | 2Q (Recency + Frequency) |
| **Transaction** | Pseudo (no rollback) | VLL (Atomic multi-shard) |

---

## 6. Interview One-Liner
> Dragonfly achieves 25x Redis throughput by using a **shared-nothing, multi-threaded architecture** that assigns data shards to specific CPU cores, eliminating lock contention and maximizing vertical scalability via modern algorithms like **DashTable** and **VLL**.