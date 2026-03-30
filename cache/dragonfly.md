---

# 14. Resharding & Scaling (Redis vs Dragonfly)

Scaling is not just about adding more nodes —  
it’s about **how data is redistributed (resharding)** when the cluster changes.

---

## 14.1 Redis Scaling & Resharding

### Architecture

Redis Cluster:

- Uses **16384 hash slots**
- Each key is mapped to a slot:

```
slot = CRC16(key) % 16384
```

- Each node owns a subset of slots

---

### Adding a Node

When a new node is added:

1. The cluster assigns some slots from existing nodes to the new node  
2. Data must be **migrated slot by slot**

---

### Resharding Process

```
Source Node ────► Target Node
   (slot X)         (slot X)
```

Steps:

- Lock slot (temporarily)
- Migrate keys one by one
- Update cluster metadata

---

### Characteristics

- **Online but not free**
- Causes:
  - Network overhead  
  - Increased latency during migration  
- Requires careful orchestration

---

### Removing a Node

- All slots of that node must be moved to other nodes  
- Same migration process applies  

---

### Key Limitation

> Redis resharding is **explicit and operationally heavy**

---

## 14.2 Dragonfly Scaling & Resharding

Dragonfly has **two levels of scaling**:

---

## (A) Vertical Scaling (Within a Node)

This is where Dragonfly shines.

### Mechanism

- Data is split into **N shards**
- Each shard is owned by a thread

```
shard_id = hash(key) % N
```

---

### When Threads Change

If you increase threads:

```
Old: N = 4
New: N = 8
```

→ Shard mapping changes

---

### Problem

- `hash(key) % N` is **not stable**
- Many keys must move between shards

---

### Solution

Dragonfly handles this cleanly because vertical scaling is usually an **offline upgrade**:

- Save snapshot on the old configuration
- Restart process with more threads (on larger hardware)
- During load, keys are naturally mapped to new `shard_id`
- No online background migration lock/stall needed

---

### Characteristics

- Happens **during load inside a single process**
- Avoids the nightmare of network-based online migration
- Requires brief downtime (restart) for the upgraded node  

---

## (B) Horizontal Scaling (Multi-node)

Dragonfly (like Redis) can scale across nodes, but:

- It does **not rely heavily on cluster mode like Redis**
- Focus is more on **vertical scaling efficiency**

---

### Key Difference vs Redis

| Aspect | Redis | Dragonfly |
|------|------|-----------|
| Scaling Strategy | Horizontal (cluster) | Vertical-first (also supports Swarm) |
| Resharding | Slot migration (network) | Load-time mapping / Optimized Network (Swarm) |
| Cost | High (network + coordination) | Lower for vertical, optimized for horizontal |
| Complexity | High | Lower |

---

## 14.3 The Real Trade-off

### Redis

**Pros:**

- Mature cluster model  
- True horizontal scaling  

**Cons:**

- Resharding is expensive  
- Operational complexity  

---

### Dragonfly

**Pros:**

- Extremely efficient on single node  
- Better CPU utilization  
- Faster internal resharding  

**Cons:**

- Cross-node scaling story is less mature  
- Still requires redistribution when shard count changes  

---

## 14.4 Advanced Insight (Important for Interview)

### Problem with `hash(key) % N`

When `N` changes:

```
hash(key) % 4 ≠ hash(key) % 8
```

→ Almost all keys need to move

---

### Better Approach (Used in Many Systems)

**Consistent Hashing**

- Minimizes key movement  
- Only a small portion of keys are remapped  

Redis Cluster partially solves this using **hash slots**.

---

## 14.5 Final Takeaway

- Redis scales **horizontally** but pays the cost in resharding complexity  
- Dragonfly scales **vertically first**, maximizing single-node performance  

> Redis optimizes for distribution  
> Dragonfly optimizes for locality and CPU efficiency  

---

## 14.6 Interview One-Liner

> Redis uses hash slots and performs explicit resharding across nodes, which is operationally expensive, while Dragonfly focuses on vertical scaling with shard-per-thread design and performs faster in-memory redistribution when scaling within a node.