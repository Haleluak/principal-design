# Why Redis Is “Fast” Despite Being Single-Threaded

> At first glance, Redis seems inefficient: a single thread handling all commands.
> But in reality, its design is what makes it extremely fast.

---

## 1. The Misconception

In short:

- Redis uses a **single thread for command execution**
- But can use **multiple threads for I/O (since Redis 6+)**

This leads to a common misunderstanding:

> “Redis is slow because it only uses one CPU core”

That assumption is **wrong**.

To understand why, we need to look at how I/O actually works.

---

## 2. What Really Happens When a Client Sends a Request

When a client sends a command:

- It writes data to a **socket**
- A socket is defined by:
  - IP address
  - Port number

On the server side:

- Redis reads data using a file descriptor (`fd`)
- And calls:

```c
ssize_t read(int fd, void *buf, size_t count);
```

---

## 3. The Problem with Blocking I/O

By default, `read()` is **blocking**.

### Blocking Flow

```
Client -----> Server (read)

            [No data yet]
                  ↓
           Thread goes to sleep
                  ↓
         (waiting... doing nothing)
                  ↓
           Data arrives
                  ↓
           Thread wakes up
```

### Why This Is Bad

- The thread **cannot do anything else**
- CPU is **underutilized**
- You need **many threads** to handle many clients

---

## 4. Traditional Solution: Multi-threading

To solve the issue of threads being blocked while waiting (Blocking I/O), traditional systems create a large number of **OS Threads** to serve multiple clients simultaneously.

### Deep-dive: Physical Threads vs OS Threads

To understand why many threads cause slowdowns, we must distinguish between:

1.  **Physical Thread (Hardware Thread/Core):** The actual hardware execution unit of the CPU (e.g., a machine with 8 Cores / 16 Hardware Threads). This is the limit of how many tasks can truly run in **parallel** at any given moment.
2.  **OS Thread (Software Thread):** An abstraction created by the Operating System. You can spawn thousands of OS Threads even if you only have 8 physical cores.

### How the OS "Fakes" Parallelism (Scheduling)

When you have 1000 OS Threads but only 8 physical cores:
- The OS performs **Scheduling**: It allows Thread 1 to run on Core 1 for a few milliseconds (a quantum), then forcibly stops Thread 1 so Thread 2 can take its place.
- This process is called **Context Switching**.

### Why is creating many threads expensive?

-   **Memory Overhead:** Each OS Thread requires its own reserved memory area (Stack), typically 1MB - 8MB. With 10,000 threads, you immediately consume ~10GB - 80GB of RAM just for their existence.
-   **CPU Overhead (Context Switch):** Each time a thread is swapped, the CPU must:
    1.  Save all registers and the Program Counter of the old thread.
    2.  Load the state of the new thread.
    3.  Flush CPU Caches (L1, L2, L3) because the new thread requires completely different data.

> **Conclusion:** When too many OS Threads compete for a few physical cores, the CPU spends most of its time **swapping seats (Context Switching)** rather than actually processing client requests. This is why Redis chooses a Single-thread + epoll approach to maximize the use of a single physical core without the overhead of swapping seats.

---

## 5. Redis Approach: I/O Multiplexing

Instead of:

> “Wait on each socket”

Redis does:

> “Watch all sockets and only act when needed”

---

## 6. epoll (I/O Multiplexing): The Core Mechanism

### Key Idea

*(Note: Linux uses `epoll`, macOS uses `kqueue`, but the concept is identical)*

```
Server → Kernel:
"Here are 1000 sockets.
Tell me when ANY of them is ready."
```

---

## 7. epoll Flow Diagram

```
                ┌────────────────────┐
                │      Kernel        │
                │ (epoll monitoring) │
                └─────────┬──────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
     Socket1          Socket2          Socket3
   (no data)        (has data)       (no data)
        │                 │                 │
        └──────────┬──────┴──────┬──────────┘
                   │             │
               epoll_wait() wakes up
                   │
          Returns ONLY ready fds
                   │
                [Socket2]
```

---

## 8. Event Loop (Redis Core)

```
while (true) {
    ready_fds = epoll_wait()

    for fd in ready_fds {
        read(fd)             // never blocks
        process_command()    // single-threaded
        write_response(fd)
    }
}
```

### Key Insight

- Redis **never waits on empty sockets**
- It only processes **ready data**

---

## 9. Why Single Thread Is Actually an Advantage

### No Locks

- No race conditions
- No mutex overhead

### No Context Switching

- CPU stays hot
- Better cache locality

### Predictable Performance

- Simple execution model
- Easier to optimize

### CPU is Rarely the Bottleneck (Crucial Interview Detail)

- Redis manipulates data directly in RAM, which is incredibly fast
- Bottlenecks are almost always **Network Bandwidth** or **Memory capacity**, not CPU
- One core is usually enough to completely saturate the server's network card

---

## 10. Connection Pooling (Client Side Impact)

### 1:1 Mapping Rule

```
N client connections = N server file descriptors
```

### Example

- Pool size = 100
- Redis must handle 100 sockets

### Why Pooling Matters

- Avoid connection overhead
- Keep sockets alive
- Improve latency

---

## 11. Comparison

| Feature | Blocking I/O (Multi-threaded) | Redis (Event-driven) |
|--------|------------------------------|----------------------|
| Threads | 1 per client | 1 main thread |
| CPU Usage | Low (idle waiting) | High (active work) |
| Context Switching | High | Minimal |
| Scalability | Limited | Massive |

---

## 12. Big Picture Diagram

```
        Traditional Model                    Redis Model

   ┌───────────────┐                 ┌────────────────────┐
   │ Thread per    │                 │ Single Event Loop  │
   │ connection    │                 │ + epoll            │
   └──────┬────────┘                 └─────────┬──────────┘
          │                                    │
   ┌──────▼──────┐                      ┌──────▼──────┐
   │ Thread 1    │ (sleeping)           │ Ready fd    │
   ├─────────────┤                      │ processing  │
   │ Thread 2    │ (sleeping)           ├─────────────┤
   ├─────────────┤                      │ Ready fd    │
   │ Thread 3    │ (sleeping)           │ processing  │
   └─────────────┘                      └─────────────┘
```

---

## 13. Final Takeaway

Redis is not fast **despite** being single-threaded.

It is fast **because**:

- It avoids blocking I/O
- It uses epoll for scalability
- It processes only ready data
- It eliminates threading overhead

> Redis doesn't waste time waiting.
> It only works when there is real work to do.

---

## 14. Interview One-Liner

> Redis achieves high performance by combining a single-threaded execution model with I/O multiplexing (epoll), allowing it to handle thousands of concurrent connections efficiently without the overhead of multi-threading.