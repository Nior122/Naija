# One-World Scaling Architecture

**Version:** 1.0  
**Date:** 2026-10-10  
**Status:** Implemented (Phase 1)

---

## Overview

This document describes the architecture for scaling Naija: One World from a single-server prototype to a distributed, multi-server architecture while maintaining the core principle of **one authoritative Nigerian world**.

### Core Principle

**One Country. One World. Millions of Lives.**

All servers, regardless of physical deployment, must serve the same logical Nigerian world. Players in Lagos and players in Kano must interact with the same President, the same economy, the same election results, and the same historical record.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Clients (Godot 4.7.2)                     │
│                    2D Mode  |  3D Mode                        │
└────────────┬─────────────────────────────┬──────────────────┘
             │                             │
             └──────────┬──────────────────┘
                        │ WebSocket
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Load Balancer / Router                       │
│         (Routes players to appropriate server)                │
└────────────┬─────────────────────────────┬──────────────────┘
             │                             │
             ▼                             ▼
┌──────────────────────┐       ┌──────────────────────┐
│   Server Instance 1  │       │   Server Instance 2  │
│                      │       │                      │
│  ┌────────────────┐  │       │  ┌────────────────┐  │
│  │ World Identity │  │       │  │ World Identity │  │
│  │  (nigeria-main)│  │       │  │  (nigeria-main)│  │
│  └────────────────┘  │       │  └────────────────┘  │
│                      │       │                      │
│  ┌────────────────┐  │       │  ┌────────────────┐  │
│  │    Region      │  │       │  │    Region      │  │
│  │   Ownership    │  │       │  │   Ownership    │  │
│  │  (Lagos: 0-3)  │  │       │  │  (Abuja: 0-2)  │  │
│  └────────────────┘  │       │  └────────────────┘  │
│                      │       │                      │
│  ┌────────────────┐  │       │  ┌────────────────┐  │
│  │    Session     │  │       │  │    Session     │  │
│  │   Management   │  │       │  │   Management   │  │
│  └────────────────┘  │       │  └────────────────┘  │
│                      │       │                      │
│  ┌────────────────┐  │       │  ┌────────────────┐  │
│  │    Transition  │  │       │  │    Transition  │  │
│  │    Manager     │  │       │  │    Manager     │  │
│  └────────────────┘  │       │  └────────────────┘  │
│                      │       │                      │
│  ┌────────────────┐  │       │  ┌────────────────┐  │
│  │     Game       │  │       │  │     Game       │  │
│  │     Logic      │  │       │  │     Logic      │  │
│  │  (Stages 1-23) │  │       │  │  (Stages 1-23) │  │
│  └────────────────┘  │       │  └────────────────┘  │
└──────────┬───────────┘       └──────────┬───────────┘
           │                               │
           └───────────────┬───────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │    Database (Phase 2)    │
              │                          │
              │  - World State           │
              │  - Region Ownership      │
              │  - Sessions              │
              │  - Player Data           │
              │  - Financial Records     │
              └─────────────────────────┘
```

---

## Component Descriptions

### 1. World Identity Management

**Purpose:** Ensure exactly one authoritative Nigerian world exists.

**Key Concepts:**
- **World ID:** `nigeria-main` (constant)
- **World Version:** Tracked for migration purposes
- **Validation:** All servers validate world ID on startup
- **Prevention:** `assertSingleAuthoritativeWorld()` prevents accidental forking

**Data Flow:**
```
Server Startup
    ↓
Load World State
    ↓
Validate World ID = "nigeria-main"
    ↓
If mismatch → CRITICAL ERROR, refuse to start
    ↓
Continue with authoritative world
```

**Consistency:** Strong (immediate validation)

---

### 2. Region Ownership System

**Purpose:** Manage which server owns which geographic regions.

**Key Concepts:**
- **Region:** Geographic area (state, city, or partition)
- **Partition:** Subdivision of busy regions (e.g., Lagos has 4 partitions)
- **Fencing Token:** Monotonically increasing number per region
- **Lease:** Time-limited ownership (default 30 seconds)
- **Heartbeat:** Periodic renewal of lease

**Ownership Acquisition:**
```
Server A requests ownership of Region X
    ↓
Check current ownership
    ↓
If owned by Server B with valid lease:
    → Reject request (conflict)
    ↓
If no owner or lease expired:
    → Generate next fencing token
    → Grant ownership to Server A
    → Set lease expiration (now + 30s)
    ↓
Server A writes with fencing token
    ↓
Other servers reject writes with old tokens
```

**Fencing Token Protection:**
```
Time 0: Server A acquires Region X, token = 5
Time 10: Server A's lease expires (no heartbeat)
Time 15: Server B acquires Region X, token = 6
Time 20: Server A wakes up, tries to write with token = 5
    ↓
System rejects write (token 5 < current token 6)
    ↓
Server A's stale write prevented
```

**Consistency:** Strong (fencing tokens prevent stale writes)

---

### 3. Session Management

**Purpose:** Handle player sessions, reconnection, and transfers.

**Key Concepts:**
- **Session:** Temporary connection between player and server
- **Session ID:** Unique identifier for session
- **Player ID:** Permanent identifier for player
- **Status:** active, disconnected, transferred, expired
- **Grace Period:** Time allowed for reconnection (60 seconds)

**Session Lifecycle:**
```
Player connects
    ↓
Create session (status: active)
    ↓
Player plays game
    ↓
Network disconnects
    ↓
Mark session as disconnected
    ↓
Player reconnects within 60s
    ↓
Restore session (status: active)
    ↓
Player continues game
```

**Cross-Region Transfer:**
```
Player in Lagos wants to move to Abuja
    ↓
Initiate transition
    ↓
Validate player state
    ↓
Save state durably
    ↓
Transfer to Abuja server
    ↓
Create new session on Abuja server
    ↓
Mark old session as transferred
    ↓
Player continues in Abuja
```

**Consistency:** Strong (one active session per player)

---

### 4. Cross-Region Transitions

**Purpose:** Atomic player movement between geographic regions.

**Key Concepts:**
- **Transition:** Multi-step process of moving player
- **Atomic:** Either completes fully or rolls back
- **State Preservation:** Player state never lost
- **No Duplicates:** Player never exists in two regions simultaneously

**Transition Steps:**
```
1. Initiate Transition
   - Validate source session
   - Validate destination region
   - Create transition record

2. Validate Source State
   - Check player state consistency
   - Verify no conflicting operations

3. Save Player State
   - Write state to durable storage
   - Ensure atomic commit

4. Transfer to Destination
   - Mark source session as transferred
   - Send state to destination server

5. Create New Session
   - Create session on destination server
   - Restore player state

6. Complete Transition
   - Mark transition as completed
   - Clean up old session

On any failure:
   - Roll back to saved state
   - Mark transition as failed
   - Player remains in source region
```

**Consistency:** Strong (atomic with rollback)

---

### 5. Data Classification

**Purpose:** Categorize data by consistency and persistence requirements.

**Categories:**

#### Global Authoritative Data
- **Examples:** World identity, national government, election results
- **Consistency:** Strong
- **Persistence:** Immediate durable
- **Synchronization:** Immediate broadcast to all servers
- **Update Frequency:** Rare

#### Player-Owned Data
- **Examples:** Character, inventory, education, employment
- **Consistency:** Strong
- **Persistence:** Immediate durable
- **Synchronization:** On demand
- **Update Frequency:** Moderate

#### Financial and Ownership Data
- **Examples:** Accounts, transactions, businesses, properties
- **Consistency:** Strong
- **Persistence:** Immediate durable
- **Synchronization:** On demand (with idempotency)
- **Update Frequency:** Frequent

#### Regional Simulation Data
- **Examples:** NPC state, local environment, nearby players
- **Consistency:** Eventual
- **Persistence:** Periodic snapshot
- **Synchronization:** Regional broadcast
- **Update Frequency:** Very frequent

#### Transient Data
- **Examples:** Movement updates, presence, session state
- **Consistency:** Best effort
- **Persistence:** Memory only
- **Synchronization:** Interest-based
- **Update Frequency:** Continuous

**Consistency Model:**
```
Strong Consistency:
  - All servers see same data at same time
  - Used for critical game state
  - Slower but safe

Eventual Consistency:
  - Servers converge over time
  - Used for non-critical state
  - Faster but may have temporary inconsistencies

Best Effort:
  - No guarantees
  - Used for transient data
  - Fastest but may lose data
```

---

### 6. Idempotent Operations

**Purpose:** Prevent duplicate processing of financial operations.

**Key Concepts:**
- **Idempotency Key:** Unique identifier for operation
- **Idempotent:** Operation can be applied multiple times with same result
- **Cache:** Store results of completed operations
- **TTL:** Time-to-live for cached results (24 hours)

**Idempotency Flow:**
```
Client wants to transfer 1000 Naira
    ↓
Generate idempotency key: "idem-abc123"
    ↓
Send request with key
    ↓
Server checks cache for key
    ↓
If key exists and completed:
    → Return cached result
    → No duplicate transfer
    ↓
If key exists and pending:
    → Reject request (operation in progress)
    ↓
If key doesn't exist:
    → Execute transfer
    → Store result in cache with key
    → Return result
    ↓
Client retries with same key
    ↓
Server returns cached result
```

**Guarantee:** Financial operations never processed twice

---

## Data Flow Examples

### Example 1: Player Creates Character

```
Client: Create character "Ada"
    ↓
Server: Validate request
    ↓
Server: Create character record
    ↓
Server: Assign to player
    ↓
Server: Persist to database
    ↓
Server: Return success
    ↓
Client: Display character
```

**Consistency:** Strong (immediate persistence)  
**Idempotency:** Not required (create is naturally idempotent)

---

### Example 2: Player Transfers Money

```
Client: Transfer 5000 Naira to Bob
    ↓
Client: Generate idempotency key "idem-xyz789"
    ↓
Client: Send request with key
    ↓
Server: Check idempotency cache
    ↓
Server: Key not found, execute transfer
    ↓
Server: Debit 5000 from Alice
    ↓
Server: Credit 5000 to Bob
    ↓
Server: Record transaction
    ↓
Server: Store result in cache with key
    ↓
Server: Return success
    ↓
Client: Display success
    ↓
Network disconnects, client retries
    ↓
Client: Send same request with same key
    ↓
Server: Check idempotency cache
    ↓
Server: Key found, return cached result
    ↓
Client: Display success (no duplicate transfer)
```

**Consistency:** Strong (transactional)  
**Idempotency:** Required (financial operation)

---

### Example 3: Player Moves Between Regions

```
Player in Lagos (Server A) wants to move to Abuja (Server B)
    ↓
Client: Request transition to Abuja
    ↓
Server A: Validate player state
    ↓
Server A: Check Abuja region ownership
    ↓
Server A: Confirm Server B owns Abuja
    ↓
Server A: Save player state durably
    ↓
Server A: Mark session as transferred
    ↓
Server A: Send state to Server B
    ↓
Server B: Create new session
    ↓
Server B: Restore player state
    ↓
Server B: Return success
    ↓
Client: Connected to Server B
    ↓
Client: Player in Abuja
```

**Consistency:** Strong (atomic transition)  
**Idempotency:** Not required (transition is atomic)

---

## Deployment Model

### Phase 1: Single Server (Current)

```
┌─────────────────────┐
│   Single Server     │
│                     │
│  - All regions      │
│  - All sessions     │
│  - All players      │
│                     │
│  JSON File Storage  │
└─────────────────────┘
```

**Characteristics:**
- Simple deployment
- No coordination needed
- Limited scalability
- Single point of failure

---

### Phase 2: Multiple Servers (Planned)

```
┌──────────────────┐   ┌──────────────────┐
│   Server 1       │   │   Server 2       │
│  Lagos (0-3)     │   │  Abuja (0-2)     │
│  Ogun            │   │  Kano            │
│  Oyo             │   │  Kaduna          │
└────────┬─────────┘   └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────┴──────┐
              │  Database   │
              └─────────────┘
```

**Characteristics:**
- Load distribution
- Fault tolerance
- Coordination via database
- Region ownership with fencing tokens

---

### Phase 3: Production Scale (Future)

```
┌─────────────────────────────────────────┐
│         Load Balancer / Router           │
└────┬──────────┬──────────┬──────────┬───┘
     │          │          │          │
     ▼          ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Server 1│ │ Server 2│ │ Server 3│ │ Server 4│
│ Lagos   │ │ Abuja   │ │ Kano    │ │ Rivers  │
└────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
     │           │           │           │
     └───────────┴───────────┴───────────┘
                     │
              ┌──────┴──────┐
              │   Database  │
              │   Cluster   │
              └─────────────┘
```

**Characteristics:**
- High availability
- Horizontal scaling
- Geographic sharding
- Comprehensive monitoring

---

## Security Considerations

### Authentication

- Players authenticate with token-based system
- Tokens validated on every request
- Session tied to authenticated player

### Authorization

- Players can only modify their own data
- Financial operations require server validation
- Administrative operations require special permissions

### Anti-Cheat

- Server validates all game state changes
- Fencing tokens prevent stale writes
- Idempotency prevents duplicate operations
- Rate limiting prevents abuse

### Data Protection

- Sensitive data encrypted at rest
- Secrets not logged
- PII handled according to privacy policy

---

## Monitoring and Observability

### Metrics (Planned)

- Active connections per server
- Region ownership changes
- Session creation/expiration rates
- Transition success/failure rates
- Idempotency cache hit rates
- Database query latency
- Memory usage per server

### Logging (Planned)

- Server startup/shutdown
- Region ownership changes
- Session lifecycle events
- Transition events
- Financial operations
- Errors and exceptions

### Alerting (Planned)

- Server down
- Region ownership conflicts
- High transition failure rate
- Database connection issues
- Memory usage high

---

## Future Enhancements

### Phase 2 Enhancements

1. **Database Integration**
   - PostgreSQL for persistent storage
   - Redis for session cache
   - Automatic failover

2. **Monitoring**
   - Prometheus metrics
   - Grafana dashboards
   - Alertmanager alerts

3. **Deployment**
   - Docker containers
   - Kubernetes orchestration
   - Automatic scaling

### Phase 3 Enhancements

1. **Advanced Routing**
   - Geographic routing
   - Load-based routing
   - Latency-based routing

2. **Cross-Region Events**
   - National events
   - Cross-region travel
   - Global leaderboards

3. **Performance Optimization**
   - Caching layers
   - Query optimization
   - Connection pooling

---

## Conclusion

The one-world scaling architecture provides a solid foundation for growing Naija: One World from a single-server prototype to a production-scale distributed system while maintaining the core principle of one authoritative Nigerian world.

**Key Principles:**
- ✅ Single logical world
- ✅ Strong consistency for critical data
- ✅ Fencing tokens for safety
- ✅ Atomic transitions
- ✅ Idempotent operations
- ✅ Backward compatibility

**Next Steps:**
1. Integrate with database (Phase 2)
2. Deploy multiple servers (Phase 2)
3. Add monitoring (Phase 2)
4. Scale to production (Phase 3)

---

**Document Version:** 1.0  
**Last Updated:** 2026-10-10  
**Author:** Arena AI Agent  
**Status:** Complete
