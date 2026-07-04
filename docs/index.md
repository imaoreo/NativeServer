# NativeGrind Backend API

Welcome to the documentation site for the **NativeGrind Go Backend**. 

This server manages security attestations, pairing sessions, and companion API key authorizations for native mobile clients.

---

## Key Features

* **Single-Connection WebSocket API**: Migrated all critical routes to a unified real-time `/ws` connection.
* **Apple App Attest Integration**: Validates and cryptographically verifies device attestations and assertions.
* **Seamless QR Code Pairing**: Server-side 8-digit random code generation for quick scanning and pairing.
* **Persistent Companion Database**: Organizes companion device records and limits access to 4 companion keys per primary device.
* **Discord Integration**: Admin-approved manual API keys requesting interface.

---

## Quick Start Guide

### 1. Requirements
Ensure you have the following installed locally:
- [Go (1.21+)](https://go.dev/dl/)
- [Docker & Compose](https://www.docker.com/)

### 2. Local Setup
Clone the repository and copy the environment template:
```bash
git clone https://github.com/imaoreo/NativeServer.git
cd NativeServer
cp .env.example .env
```

Start the PostgreSQL database and Redis services in the background:
```bash
docker compose up -d postgres redis
```

Run the server:
```bash
go run main.go
```

The server will startup on port `8080` (by default) and automatically run database schema migrations.
