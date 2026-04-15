# Broker Tech Radar: Kafka vs Pulsar vs NATS JetStream

This document is a Principal-level decision matrix to evaluate the three dominant streaming/messaging brokers. Rather than declaring a single "winner," this matrix defines the architectural trade-offs, profound weaknesses, and distinct operational sweet spots of each technology.

---

## 1. Philosophical Architecture & Core Paradigms

| Technology | The Philosophy | Core Architecture | Storage Engine |
| :--- | :--- | :--- | :--- |
| **Apache Kafka** | *"Dumb broker, smart clients."* Optimized for brutal sequential disk I/O. Relies on the OS Page Cache. | Monolithic. Compute and Storage are forcefully bound to the same physical node. | Append-Only Sequential Files (Partitions). |
| **Apache Pulsar** | *"Cloud-native and decoupled."* Designed to solve Kafka's physical operational pain points at a massive global scale. | Two-Tiered (Separada). Compute (Brokers) is strictly decoupled from Storage. | Apache BookKeeper (Fragmented Ledgers). |
| **NATS JetStream** | *"Simplicity, speed, and edge-native."* Operates like an optimized network switch. | Monolithic Embedded. A single `<20MB` compiled Go binary running an embedded Raft node. | In-Memory Routing + Memory-Mapped Files (mmap). |

---

## 2. In-Depth Pros & Cons Analysis

### 2.1. Apache Kafka
**The Gold Standard Heavyweight.** 

*   **Strengths (Why Choose It?)**
    *   **The Ecosystem Monopoly:** Almost guaranteed integration with every Data Engineering tool on earth (Spark, Flink, ClickHouse, Debezium).
    *   **Battle-Tested Stability:** Runs the core data nervous systems of Uber, LinkedIn, and Netflix. Unmatched maturity.
    *   **Extreme Throughput:** Brutally efficient when batching billions of messages onto mechanical disks via Zero-Copy (`sendfile()`).
*   **Weaknesses (Why Avoid It?)**
    *   **The Rebalance Storm:** Consumer group rebalancing halts the world unless carefully tamed (Cooperative rebalancing).
    *   **Topic/Partition Scaling Ceiling:** You physically cannot scale past a few thousand partitions per node without blowing up file descriptors and election latency. Scaling storage requires copying Terabytes of data manually across the network.
    *   **Operational Heavyweight:** Requires strict JVM tuning and previously required Zookeeper (now KRaft, but still heavy).

### 2.2. Apache Pulsar
**The Enterprise Cloud-Native Beast.**

*   **Strengths (Why Choose It?)**
    *   **Zero-Copying Scale:** When adding a new storage node (Bookie), data is striped over it immediately. No partition copying, no migrating data to expand clusters.
    *   **Unified Messaging (Queuing + Streaming):** Kafka requires strict sequential processing. Pulsar allows Shared Subscriptions to behave exactly like RabbitMQ (per-message acknowledgment & individual redelivery).
    *   **Native Tiered Storage:** Old data automatically slides off expensive SSD Bookies straight into AWS S3 seamlessly. 
    *   **Multi-Tenancy:** Built-in isolation for distinct teams dynamically.
*   **Weaknesses (Why Avoid It?)**
    *   **Infrastructural Complexity:** You must operate Brokers, BookKeepers, and Zookeepers. It is exceptionally complex to debug when things crash compared to a single Kafka node.
    *   **Network Hop Penalty:** Because compute and storage are split, every publish involves a network hop from Broker to Bookie, increasing baseline latency.
    *   **Community Size:** The skill pool and third-party integration ecosystem are significantly smaller than Kafka's.

### 2.3. NATS JetStream
**The Hyper-agile Edge Nervous System.**

*   **Strengths (Why Choose It?)**
    *   **Wildcard Routing & Ephemerality:** Subscribing to `sensors.*.temperature` instantly routes millions of unpredictable dynamic subjects without needing to pre-configure physical partitions.
    *   **Deployment Elegance:** One single `./nats-server` binary. No JVM, no Zookeeper. Runs flawlessly on a 2GB Raspberry Pi or a 64-Core AWS EC2.
    *   **Multi-Modal Built-In:** The same binary provides streams, Distributed Key-Value stores, and S3-Object stores natively.
    *   **Ultra-Low Latency:** Written in Go, completely pushes data directly into TCP sockets in microseconds.
*   **Weaknesses (Why Avoid It?)**
    *   **No Native Partitions:** NATS doesn't partition streams for deterministic ordering scale like Kafka. You rely on "Queue Groups" (which don't guarantee strict key ordering) or complex client-side sharding.
    *   **Memory Bound:** If you misconfigure your Memory-Mapped limits, a large retention spike can instantly crash the node due to OOM (Out of Memory). It is completely unforgiving of memory abuse compared to Kafka's reliance on swap/page cache.
    *   **Weak Analytics Ecosystem:** Do not use NATS if your end goal is dumping data into heavy OLAP engines via native connectors.

---

## 3. The Principal's Verdict: When to Use What?

The decision rarely comes down to throughput benchmarks (they can all saturate a network card). It boils down to **operational topology and data destinations**.

**1. Choose Apache Kafka IF:**
You are building an **Events & Big Data Backbone**. If the data is destined for Machine Learning pipelines, Apache Spark, Snowflake, or ELK, Kafka is the unbreakable standard. If you want to hire 10 data engineers tomorrow, they will already know Kafka. 
*Use Case: User Clickstream Tracking, CDC (Change Data Capture) from databases.*

**2. Choose Apache Pulsar IF:**
You act as a **Cloud Provider for your own Enterprise**. If you are a platform team providing "Messaging-as-a-Service" to 50 different microservice teams, Pulsar is supreme. Its native multi-tenancy, transparent Tiered Storage to S3, and ability to act as both a Stream and a Queue simultaneously means you only have to maintain one technology stack instead of juggling Kafka AND RabbitMQ.
*Use Case: High-scale Unified Event Bus, Multi-tenant Financial ledgers.*

**3. Choose NATS JetStream IF:**
You are building **Hyper-Dynamic Microservices or Edge/IoT Architectures**. If you need to route millions of dynamic subjects (e.g., millions of IoT device IDs `device.123.status`), Kafka partitions will collapse. NATS runs seamlessly across global edge networks, requiring zero operational babysitting.
*Use Case: Real-time Live Metrics, IoT Fleet Management, WebSocket backend syncing, Multiplayer Game routing.*
