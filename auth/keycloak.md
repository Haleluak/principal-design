# Keycloak Architectural Deep Dive

Keycloak is an open-source Identity and Access Management (IAM) solution designed for modern applications and services. It provides a robust set of features including single sign-on (SSO), identity brokering, and user federation.

## Core Concepts

| Concept | Description | Analogy |
| :--- | :--- | :--- |
| **Realm** | A dedicated space for managing users, roles, and applications. | **Identity Domain** |
| **Client** | An application that requests authentication for a user. | **Application** |
| **Scope** | Defines the permissions or data included in a token. | **Token Data** |
| **Role** | A logical grouping of permissions assigned to users. | **Permission** |
| **Flow** | The sequence of steps required for a specific action (e.g., login). | **Pipeline** |

---

## Realm Architecture

```mermaid
graph TD
    Realm["Realm (Identity Domain)"]
    Realm --> Users
    Realm --> Groups
    Realm --> Roles
    Realm --> Clients
    Realm --> Scopes["Client Scopes"]
    Realm --> IdP["Identity Providers (Google, FB, ...)"]
    Realm --> AuthFlows["Authentication Flows"]

    subgraph "Roles Hierarchy"
        Roles --> RR["Realm Roles (Global: Admin, User)"]
        Roles --> CR["Client Roles (App-specific: Editor, Viewer)"]
    end

    subgraph "Clients"
        Clients --> Web["Web App"]
        Clients --> Mobile["Mobile App"]
    end
```

---

## Authentication Flows

Keycloak supports multiple OAuth 2.0 and OpenID Connect (OIDC) flows tailored for different use cases.

### 1. Standard Flow (Authorization Code)
The default flow for OIDC.
- **Process**: Client $\rightarrow$ Redirect to Keycloak $\rightarrow$ User Login $\rightarrow$ Keycloak Authenticates.
- **Result**: Returns `access_token` + `id_token`.

### 2. Direct Access Grants (Password Flow)
Known as Resource Owner Password Credentials.
- **Process**: Client sends `username` + `password` directly to Keycloak's `/token` endpoint.
- **Security Note**: **Not recommended** for modern apps as the client handles user credentials directly.

### 3. Implicit Flow
Legacy flow for SPAs.
- **Process**: Access token is returned directly in the redirect URL fragment (`#access_token=...`).
- **Security Note**: **Deprecated**. Vulnerable to token leakage in browser history. Use **Authorization Code + PKCE** instead.

### 4. Service Account (Client Credentials Flow)
Designed for Machine-to-Machine (M2M) communication.
- **Process**: Service A $\rightarrow$ `client_id` + `client_secret` $\rightarrow$ Keycloak $\rightarrow$ `access_token`.
- **Feature**: Uses **Service Account Roles** assigned to the client itself.

### 5. Standard Token Exchange
Allows trading one token for another.
- **Use Case**: Service impersonation, Microservice delegation (Service A calls Service B on behalf of a user).
- **Grant Type**: `urn:ietf:params:oauth:grant-type:token-exchange`.

### 6. OAuth 2.0 Device Authorization Grant
For input-constrained devices (Smart TVs, CLI, IoT).
- **Process**: Device $\rightarrow$ `device_code` $\rightarrow$ User logs in on a secondary device (Phone/PC) $\rightarrow$ Device receives `access_token`.

### 7. OIDC CIBA Grant
*Client Initiated Backchannel Authentication*.
- **Process**: Client initiates auth $\rightarrow$ Keycloak pushes notification to user's mobile app $\rightarrow$ User approves out-of-band.
- **Benefit**: No browser redirect required.

---

## Recommended Modern Flows

| Application Type | Recommended Flow |
| :--- | :--- |
| **Web Application** | Authorization Code Flow |
| **SPA / Mobile** | Authorization Code + PKCE |
| **Service to Service** | Client Credentials Flow |
| **IoT / CLI** | Device Authorization Grant |
| **Advanced Auth** | CIBA |

### 🛑 PKCE (Proof Key for Code Exchange)
PKCE adds a layer of security to the Authorization Code flow by ensuring that the client requesting the token is the same one that initiated the authorization request using a unique `code_verifier`.

---

## Key Tokens

1.  **Access Token**: Used to authorize API requests.
    - *Header:* `Authorization: Bearer <access_token>`
    - *Usage:* Consumed by the frontend to display user info (e.g., name, email). **Never used for API calls.**

---

## User-Level Authorization & Role Mapping

Keycloak offers several ways to manage permissions for individual users, ranging from simple role assignments to complex resource-based policies.

### 1. Role-Based Access Control (RBAC)
This is the standard approach where users are granted permissions through roles.

| Method | Description | Use Case |
| :--- | :--- | :--- |
| **Direct Mapping** | Assigning specific roles directly to a user profile. | One-off permissions or specific administrative users. |
| **Group Mapping** | Users join a group (e.g., `HR`, `Engineering`) which inherits roles. | **Recommended** for scalable management. Changing group roles affects all members. |
| **Composite Roles** | A role that contains other roles (e.g., `Admin` = `Read` + `Write` + `Delete`). | Simplifying complex permission structures. |

### 2. Realm Roles vs. Client Roles
*   **Realm Roles**: Global permissions applicable across all clients in the realm (e.g., `super-admin`, `premium-user`).
*   **Client Roles**: Context-specific permissions for a particular application. A user can be an `Editor` in the "CMS" app but a `Viewer` in the "Analytics" app.

### 3. Fine-Grained Authorization (Authorization Services)
For requirements more granular than identity (e.g., "User A can only edit their own resource"), Keycloak provides **Authorization Services**:
*   **Resources**: The assets being protected (e.g., `/photos/123`).
*   **Scopes**: Actions permitted on resources (e.g., `view`, `delete`, `edit`).
*   **Policies**: Rules determining access (e.g., "Role must be VIP", "Time must be workplace hours").
*   **Permissions**: The binding of Resources, Scopes, and Policies.

---

## Token Lifecycle & Security

Handling token expiration and user revocation is critical for maintaining system integrity.

### 1. Token Expiration Handling
*   **Access Token**: Short-lived (e.g., 5-15 mins). When expired, the backend returns `401 Unauthorized`.
*   **Refresh Token**: Long-lived. Used by the client to obtain a new Access Token from Keycloak without re-authentication.
*   **Session Termination**: If the Refresh Token expires or the session is killed on Keycloak, the user must log in again.

### 2. User Deletion or Revocation
Because Access Tokens (JWT) are **stateless**, they remain technically valid until they expire, even if the user is deleted in the database.

**Solutions to prevent unauthorized access:**
1.  **Short TTL**: Keep Access Token life extremely short to minimize the vulnerability window.
2.  **Token Introspection**: The Backend queries Keycloak (`/protocol/openid-connect/token/introspect`) for every request to verify the token's current status.
3.  **Blacklisting/Revocation Lists**: Keycloak provides a "Not Before" policy that invalidates all tokens issued before a certain timestamp.
4.  **Backchannel Logout**: Keycloak sends a direct request to registered clients notifying them that a session has been terminated.
5.  **Refresh Check**: The most common gate. When the short-lived Access Token expires, Keycloak will refuse to issue a new one if the user is deleted or disabled.

---

## Principal's Perspective: Decisions & Trade-offs

As a Principal Engineer, it’s not just about how to use Keycloak, but how it fits into a large-scale system architecture.

### 1. The Token Bloat Issue
*   **The Problem**: Adding too many roles, groups, or custom claims into the JWT payload increases its size. Large tokens can exceed the HTTP header limit of Load Balancers (e.g., Nginx default is 4KB-8KB), leading to `431 Request Header Fields Too Large`.
*   **Solution**: Keep Access Tokens lean. Use the **UserInfo Endpoint** (`/protocol/openid-connect/userinfo`) to fetch auxiliary data that isn't required for every request's authorization logic.

### 2. High Availability (HA) & Scaling
*   **Java/JVM Overhead**: Keycloak is resource-heavy compared to Go-based solutions (Hydra/Zitadel). Monitor JVM heap and garbage collection.
*   **Infinispan Clustering**: Keycloak uses Infinispan for distributed caching of sessions and tokens. In a Multi-DC (Data Center) setup, synchronization latency is your biggest challenge.
*   **Database Connectivity**: Ensure your DB (PostgreSQL/MariaDB) has a robust connection pool (using Agroal in Keycloak 20+).

### 3. Keycloak SPI (Service Provider Interface)
*   **Extensibility**: If standard authentication doesn't fit (e.g., legacy DB hash, custom biometric auth), use Java SPIs to extend Keycloak. **Note**: SPIs run inside the JVM, so poorly written code can crash the entire IAM/SSO service.

### 4. Security Hardening Checklist
*   **Enforce PKCE**: Mandate PKCE even for Server-side apps to prevent authorization code interception.
*   **Root Realm**: Never use the `master` realm for your applications. Create a dedicated realm for each environment or product line.
*   **Audit Logging**: Configure event listeners to forward audit logs to an external observability stack (ELK/Grafana) for real-time security monitoring.

---

## Real-world Edge Cases & Troubleshooting

Practical pitfalls encountered in large-scale production environments.

### 1. The "Issuer Mismatch" (Public vs. Internal URLs)
*   **The Problem**: Client initiates auth via `https://auth.company.com`. Backend (inside K8s) verifies token via internal DNS `http://keycloak-service:8080`.
*   **Result**: Backend rejects token because the `iss` (issuer) field in JWT is `https://auth.company.com`, but the internal lookup expects `http://keycloak-service:8080`.
*   **Fix**: Set `KC_HOSTNAME` consistently to the public URL for both internal and external traffic.

### 2. Clock Skew (Time Sync Failure)
*   **The Problem**: App server and Keycloak server are out of sync by just a few seconds.
*   **Result**: Valid tokens are rejected with `Token is not valid yet` (iat in the future) or `Token expired`.
*   **Fix**: Use **Network Time Protocol (NTP)** to synchronize all servers in the infrastructure.

### 3. SameSite Cookie Restrictions
*   **The Problem**: Modern browsers (Chrome/Safari) block third-party cookies by default.
*   **Result**: Silent refresh flows occurring in hidden iframes will fail, causing unexpected session logouts even if the user is active.
*   **Fix**: Configure Keycloak for `SameSite=None; Secure` cookies and ensure HTTPS is used throughout.

### 4. Orphaned Sessions (Partial Logout)
*   **The Problem**: User logs out of App A. App B (participating in the same SSO) is still open.
*   **Result**: Without **Backchannel Logout** or **Frontchannel Logout** correctly configured, App B remains active until its local token expires—a major security blind spot.

### 5. Home Realm Discovery (HRD)
*   **The Problem**: Multi-tenant apps requiring users to be redirected to their specific corporate IdP (SAML/OIDC) based on their email domain.
*   **Fix**: Implement a custom **Identity Provider Redirector** in the authentication flow to detect `user@enterprise.com` and route to the correct provider automatically.
