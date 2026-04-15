# Apache Pulsar: Principal-Level System Design

This document serves as an architectural blueprint and advanced reference guide for Apache Pulsar. Pulsar represents the "next generation" of distributed messaging, fundamentally solving many of Kafka's operational pain points by separating compute architectures from storage architectures.

---

## 1. Core Architectural Paradigm: Compute-Storage Separation

Unlike Kafka where the Broker *is* the storage node, Pulsar cleanly decouples compute from storage. This 2-tier architecture is Pulsar's defining characteristic.

- **Brokers (Compute Tier):** Stateless servers responsible for handling client connections, message routing, and caching. They contain **zero** persistent state.
- **Bookies / Apache BookKeeper (Storage Tier):** Highly available, fault-tolerant ledger storage. BookKeeper handles the actual disk persistence.
- **Topics & Ledgers:** A Pulsar topic is divided into smaller, immutable blocks called **Ledgers** (which are further divided into Fragments). Instead of an infinite partition file, BookKeeper seamlessly rolls over Ledgers across storage nodes.
- **Zookeeper / Metadata Store:** Manages cluster configuration, coordination, and ledger metadata.

---

## 2. The "Secret Sauce": Why Pulsar Excels Operationally

Pulsar sacrifices some of Kafka's "Zero-Copy" disk simplicity to gain extraordinary operational flexibility and cloud-native scaling limits.

### 2.1. Stateless Brokers
Because brokers don't own the data, if a Broker dies, another Broker immediately takes ownership of the topic. **There is no data rebalancing or copying.** The new Broker simply points a read/write cursor at the existing BookKeeper ledgers.

### 2.2. Distributed Segment Storage (BookKeeper)
In Kafka, if you add a new Broker, it sits entirely empty until you manually reassign partitions and copy terabytes of data over the network. In Pulsar, if you add a new Bookie (storage node), **new ledgers are immediately striped across it**. Storage scaling is instant and automatic.

### 2.3. Unified Queuing & Streaming
Kafka is pure streaming (order-dependent). RabbitMQ is pure queuing (work dispatch). Pulsar does both perfectly by detaching the storage mechanism from the consumption mechanism (via Subscription Models).

---

## 3. The "Killer Features" (Business Value)

1. **Native Multi-Tenancy:** Built-in isolation for organizations, tenants, and namespaces. Policies (like auth, quotas, TTL) can be applied dynamically at the namespace level without spinning up different clusters.
2. **Infinite Partition Scalability:** Kafka struggles past a few thousand partitions due to file descriptor limits and election times. Pulsar handles millions easily because partitions are just logical pointers to BookKeeper ledgers.
3. **Tiered Storage:** When ledgers age out, Pulsar automatically offloads them from expensive NVMe Bookies directly to cheap Amazon S3 / GCS buckets without any external connectors. The consumer API masks this entirely; rewinding history transparently streams from S3.
4. **Out-of-the-box Geo-Replication:** Synchronous or asynchronous replication across global data centers is deeply embedded directly in the broker architecture.

---

## 4. Principal Notes on Scaling & Production Bottlenecks

### 4.1. The Network Hop Penalty
Because compute and storage are decoupled, publishing a message requires the Broker to forward it to the Bookie over the network. This introduces an extra network hop compared to Kafka. Pulsar requires highly optimized networking architectures (10-25Gbps) to avoid latency spikes under heavy throughput.

### 4.2. Zookeeper Metadata Bloat
Pulsar relies heavily on Zookeeper for transaction state, ledger metadata, and namespace coordination. Operating a massive Pulsar cluster means carefully scaling the Zookeeper ensemble, as it becomes the ultimate bottleneck before BookKeeper does. (Note: Pulsar 3.x is moving towards a Pluggable Metadata Store to mitigate this).

---

## 5. Architectural Deep-Dive: Hard Questions

### Q1: How does Pulsar solve the "Stop the World" Consumer Rebalance?
Kafka uses rigid Consumer Groups tied exactly to partitions. Pulsar uses **Subscriptions**.
*   **Key_Shared Subscription:** Multiple consumers can attach to the *same* partition. Pulsar tracks message acknowledgement on a **per-message basis** (unlike Kafka's single partition offset). If a consumer dies, Pulsar only redistributes the unacknowledged messages assigned to that specific consumer's keys, without halting the rest of the readers. There is no jittery rebalance storm.

### Q2: What happens during a Broker Crash?
*   **Detection:** Zookeeper detects the dead broker.
*   **Recovery:** A different broker automatically acquires the ownership of that broker's topics.
*   **Execution:** The new broker closes the current active Ledger in BookKeeper (sealing it so no inflight messages corrupt it) and opens a new Ledger. Clients seamlessly reconnect to the new Broker. **Recovery time is typically milliseconds**, with zero data transfer required.

### Q3: How is Exactly-Once Semantics (EOS) implemented?
Pulsar implements Transactional APIs much like Kafka, driven by a Transaction Coordinator.
1.  **Idempotent Producers:** Brokers assign sequence IDs to messages to deduplicate network retries natively.
2.  **Two-Phase Commit:** Consumers acknowledge messages and producers publish new messages wrapped in a unified Transaction ID. BookKeeper writes are mapped to this Transaction ID and only become visible to downstream readers upon the `commit` marker hitting the Transaction Log.

### Q4: Why is Pulsar considered a better drop-in for "Work Queues" than Kafka?
Kafka requires consumers to process messages strictly sequentially (Partitions). If message #5 fails, you cannot skip to #6 without committing #5 or building a complex Dead Letter Queue (DLQ).
Pulsar's **Shared Subscription** tracks individually acknowledged messages. If message #5 fails, it simply sits completely unacknowledged in the ledger while consumers merrily process #6, #7, and #8. Message #5 will be specifically redelivered later by the broker based on a `negative-acknowledgement` (nack) timer. This is true Message Queuing behavior.
