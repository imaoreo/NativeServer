# WebSocket API Reference

The entire backend communication operates over a single, real-time WebSocket endpoint at `/ws`. This page documents the connection handshake, authorization permissions levels, and event payload structures.

---

## 1. Connection & Handshake Authentication

When a client initiates a WebSocket connection to `/ws`, they can establish the connection in one of two states:

### A. Pre-Authenticated Handshake
Clients possessing valid credentials can authenticate directly during the handshake via query params or headers:
* **Query Parameters**: `?apiKey=ng_mac_...`
* **Headers**: `X-Companion-API-Key: ng_mac_...` or `Authorization: Bearer ng_mac_...`

If validation succeeds, the connection starts in the **Companion Device** or **Manual API Key** state.

### B. Unauthenticated Handshake
If no credentials are provided, the connection is accepted as **Unauthenticated**. The client must send a verification or authentication message payload inside the connection to upgrade their authorization level.

---

## 2. Authorization Levels

The WebSocket handler secures events based on the connection's current authorization level:

| Level | Description | Allowed Events |
| :--- | :--- | :--- |
| **`Unauthenticated`** | Default connection state. | `get_challenge`, `verify_attestation`, `assert_identity`, `auth`, `initiate_pairing` |
| **`Device Checked`** | Verified primary device (utilizing Apple App Attest). | All unauthenticated events + `authorize_companion`, `confirm_authorization` |
| **`Companion / Manual Key`**| Verified companion or manual API key connection. | All unauthenticated events |

---

## 3. Unauthenticated Events

These events are available to all connections, including new unauthenticated clients.

### `get_challenge`
Requests a short-lived, cryptographically secure challenge string.
* **Permission Required**: `Unauthenticated`
* **Request Payload**: *(Empty)*
  ```json
  {
    "event": "get_challenge"
  }
  ```
* **Response Payload (Success)**:
  ```json
  {
    "event": "challenge",
    "payload": {
      "challenge": "8b5f39c2-75d1-4db8-b590-b98a1a9e3a6c",
      "ttl": 300
    }
  }
  ```
* **Response Payload (Error)**:
  ```json
  {
    "event": "get_challenge",
    "payload": {
      "status": "failed",
      "error": "Failed to generate challenge"
    }
  }
  ```

---

### `verify_attestation`
Submits Apple App Attest attestation data to register a new primary device key.
* **Permission Required**: `Unauthenticated`
* **Request Payload**:
  * `keyId` (string, required): The base64-encoded or hex Key ID of the App Attest key.
  * `assertion` (string, required): The base64-encoded CBOR attestation object returned by Apple.
  * `challenge` (string, required): The active challenge string.
  ```json
  {
    "event": "verify_attestation",
    "payload": {
      "keyId": "base64_encoded_key_id",
      "assertion": "base64_encoded_attestation_cbor",
      "challenge": "8b5f39c2-75d1-4db8-b590-b98a1a9e3a6c"
    }
  }
  ```
* **Response Payload (Success)**:
  ```json
  {
    "event": "attestation_verified",
    "payload": {
      "status": "success"
    }
  }
  ```
  *Note: Upgrades connection authorization level to **Device Checked**.*
* **Response Payload (Error)**:
  ```json
  {
    "event": "verify_attestation",
    "payload": {
      "status": "failed",
      "error": "Attestation verification failed: <reason>"
    }
  }
  ```

---

### `assert_identity`
Authenticates a returning primary device using an App Attest signature of the challenge.
* **Permission Required**: `Unauthenticated`
* **Request Payload**:
  * `keyId` (string, required): The registered key ID.
  * `assertion` (string, required): The base64-encoded assertion signature.
  * `challenge` (string, required): The challenge string.
  ```json
  {
    "event": "assert_identity",
    "payload": {
      "keyId": "base64_encoded_key_id",
      "assertion": "base64_encoded_assertion_signature",
      "challenge": "8b5f39c2-75d1-4db8-b590-b98a1a9e3a6c"
    }
  }
  ```
* **Response Payload (Success)**:
  ```json
  {
    "event": "identity_verified",
    "payload": {
      "status": "success"
    }
  }
  ```
  *Note: Upgrades connection authorization level to **Device Checked**.*
* **Response Payload (Error)**:
  ```json
  {
    "event": "assert_identity",
    "payload": {
      "status": "failed",
      "error": "Assertion verification failed: <reason>"
    }
  }
  ```

---

### `auth`
Authenticates an unsupported device connection using a persistent API key.
* **Permission Required**: `Unauthenticated`
* **Request Payload**:
  * `apiKey` (string, required): The companion or manual API key starting with `ng_mac_`.
  ```json
  {
    "event": "auth",
    "payload": {
      "apiKey": "ng_mac_1c4b8e..."
    }
  }
  ```
* **Response Payload (Success)**:
  ```json
  {
    "event": "authenticated",
    "payload": {
      "status": "success"
    }
  }
  ```
  *Note: Upgrades connection authorization level to **Companion / Manual Key**.*
* **Response Payload (Error)**:
  ```json
  {
    "event": "auth",
    "payload": {
      "status": "failed",
      "error": "Invalid API key"
    }
  }
  ```

---

### `initiate_pairing`
Registers an unsupported device connection as a pending pairing session.
* **Permission Required**: `Unauthenticated`
* **Request Payload**:
  * `wantLogin` (boolean, required): `true` if this client wants to receive login/auth credentials from the scanner, `false` for API-key-only pairing.
  ```json
  {
    "event": "initiate_pairing",
    "payload": {
      "wantLogin": true
    }
  }
  ```
* **Response Payload (Success)**:
  ```json
  {
    "event": "pairing_initiated",
    "payload": {
      "status": "ready",
      "sessionId": "48175923"
    }
  }
  ```
* **Response Payload (Error)**:
  ```json
  {
    "event": "initiate_pairing",
    "payload": {
      "status": "failed",
      "error": "Failed to generate pairing code"
    }
  }
  ```

---

## 4. Device Checked Authorized Events

These events require the connection to possess the **Device Checked** authorization level.

### `authorize_companion`
Initiates authorization of a scanned pairing session.
* **Permission Required**: `Device Checked`
* **Request Payload**:
  * `sessionId` (string, required): The 8-digit scanned pairing code.
  * **Optional AppAttest Verification (Highly Recommended)**:
    * `keyId` (string): The primary device key ID.
    * `assertion` (string): Base64-encoded assertion signature.
    * `challenge` (string): Active challenge string.
  ```json
  {
    "event": "authorize_companion",
    "payload": {
      "sessionId": "48175923",
      "keyId": "base64_encoded_key_id",
      "assertion": "base64_encoded_assertion",
      "challenge": "attest_challenge_uuid"
    }
  }
  ```
* **Response Payload (To Primary)**:
  * **Scenario A: Pairing Only (`wantLogin: false`)**:
    Returns success immediately:
    ```json
    {
      "event": "companion_authorized",
      "payload": {
        "status": "success",
        "apiKey": "ng_mac_XYZ..."
      }
    }
    ```
    *Note: The paired device (U) is sent the credentials and closed:*
    ```json
    {
      "type": "authorized",
      "apiKey": "ng_mac_XYZ..."
    }
    ```
  * **Scenario B: Pairing with Login (`wantLogin: true`)**:
    Returns a confirmation prompt:
    ```json
    {
      "event": "authorize_prompt",
      "payload": {
        "sessionId": "48175923",
        "message": "Hey this device wants logged in"
      }
    }
    ```
* **Response Payload (Error)**:
  ```json
  {
    "event": "authorize_companion",
    "payload": {
      "status": "failed",
      "error": "Active pairing session not found"
    }
  }
  ```

---

### `confirm_authorization`
Responds to the login authorization prompt.
* **Permission Required**: `Device Checked`
* **Request Payload**:
  * `sessionId` (string, required): The 8-digit pairing code.
  * `approved` (boolean, required): `true` to approve login/credentials sharing, `false` to pair but reject login.
  * `clientSessionId` (string, conditional): Upstream session ID. *(Required if approved is true)*
  * `clientAuthToken` (string, conditional): Upstream auth token. *(Required if approved is true)*
  * `clientIsEmail` (string, conditional): Upstream email flag. *(Required if approved is true)*
  * `clientData` (string, conditional): Upstream device data JSON. *(Required if approved is true)*
  * **Optional AppAttest Verification**:
    * `keyId` (string): The primary device key ID.
    * `assertion` (string): Base64-encoded assertion signature.
    * `challenge` (string): Active challenge string.
  ```json
  {
    "event": "confirm_authorization",
    "payload": {
      "sessionId": "48175923",
      "approved": true,
      "clientSessionId": "active_grindr_session_id",
      "clientAuthToken": "active_grindr_auth_token",
      "clientIsEmail": "true",
      "clientData": "active_grindr_client_data"
    }
  }
  ```
* **Response Payload (To Primary)**:
  ```json
  {
    "event": "companion_authorized",
    "payload": {
      "status": "success",
      "apiKey": "ng_mac_XYZ..."
    }
  }
  ```
* **Pushed Payload (To Pairing Connection)**:
  * **If Approved (`approved: true`)**:
    ```json
    {
      "type": "authorized",
      "apiKey": "ng_mac_XYZ...",
      "clientSessionId": "active_grindr_session_id",
      "clientAuthToken": "active_grindr_auth_token",
      "clientIsEmail": "true",
      "clientData": "active_grindr_client_data"
    }
    ```
  * **If Rejected (`approved: false`)**:
    ```json
    {
      "type": "authorized",
      "apiKey": "ng_mac_XYZ..."
    }
    ```
