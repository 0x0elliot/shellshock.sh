# shellshock.sh

Remote debugging and secret sharing over the terminal. Nothing runs without a yes, nothing leaks in transit.

**Remote debugging**: a support engineer can securely request shell commands on a customer's machine. Every command requires explicit customer approval through a terminal UI.

**Secret sharing**: share API keys, tokens, and credentials end-to-end encrypted. The decryption key never reaches the server, so even over ngrok, the middleman can't read your secrets. Burns after first retrieval.

## How It Works

```
 Engineer (Server TUI)                    Customer (Client TUI)
 ┌─────────────────────┐                  ┌─────────────────────┐
 │                     │                  │                     │
 │  Type: ls -la       │  ── SSE ──────►  │  Allow ls -la?      │
 │                     │                  │  ❯ Yes              │
 │  $ ls -la           │  ◄── HTTP POST   │    No               │
 │    file1.txt        │     (output)     │                     │
 │    file2.txt        │                  │  $ ls -la ✓ exit 0  │
 │    ✓ exit 0         │                  │                     │
 └─────────────────────┘                  └─────────────────────┘
         │                                         │
         │         ┌──────────────┐                │
         └────────►│   Server     │◄───────────────┘
                   │  (Express)   │
                   │  + SQLite    │
                   └──────────────┘
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Server                                │
│                                                              │
│  Express HTTP  ◄──────────────────────►  Ink TUI             │
│  ├─ POST /api/sessions/:id/commands      ├─ Session list     │
│  ├─ GET  /api/sessions/:id/events (SSE)  ├─ Command output   │
│  ├─ POST /api/sessions/:id/respond       ├─ Command input    │
│  ├─ GET  /api/sessions/:id/engineer-events (SSE)             │
│  └─ GET  /s/:authId (secret retrieval)   └─ Secret share     │
│                                                              │
│  SessionManager (EventEmitter)                               │
│  ├─ In-memory: SSE connections, pending commands, keys       │
│  └─ Durable: SQLite (sessions, commands, output)             │
│                                                              │
│  SecretStore (EventEmitter)                                  │
│  └─ In-memory only: encrypted blobs, burn-after-read         │
└──────────────────────────────────────────────────────────────┘
                          │
              SSE (server→client)
              HTTP POST (client→server)
                          │
┌──────────────────────────────────────────────────────────────┐
│                        Client                                │
│                                                              │
│  Ink TUI                                                     │
│  ├─ Permission prompts (per-command approval)                │
│  ├─ Command log with classification badges                   │
│  ├─ Permission rule management ([p] to view/edit)            │
│  └─ Interactive command mode choice                          │
│     ├─ "I'll interact myself" — client controls terminal     │
│     └─ "Let engineer interact" — remote keystroke relay      │
│                                                              │
│  Executor                                                    │
│  ├─ child_process.spawn for normal commands                  │
│  ├─ stdio: 'inherit' for client-interactive commands         │
│  └─ node-pty for engineer-interactive commands               │
│                                                              │
│  SQLite (per-session permission rules)                       │
└──────────────────────────────────────────────────────────────┘
```

## Security

### RSA-2048 Handshake

Every session starts with a cryptographic handshake before any commands can flow:

```
Server                              Client
  │                                    │
  │  1. Generate RSA-2048 keypair      │
  │     Generate random nonce          │
  │                                    │
  │  ── handshake_challenge ────────►  │
  │     { publicKey, nonce }           │
  │                                    │
  │                                    │  2. Encrypt nonce with
  │                                    │     RSA-OAEP + public key
  │                                    │
  │  ◄── handshake_response ────────   │
  │     { encryptedNonce }             │
  │                                    │
  │  3. Decrypt with private key       │
  │     Verify nonce matches           │
  │                                    │
  │  ── handshake_complete ─────────►  │
  │                                    │
  │  Commands can now flow             │
```

### Command Safety

Commands are parsed using a **character-level finite state machine** — not regex. The FSM tracks:

- **Quote state**: single quotes, double quotes, escape sequences
- **Nesting depth**: `$()`, `()` subshells, backtick regions
- **Operator detection**: only at depth 0, outside quotes

This prevents injection attacks like `ls; rm -rf /` hiding behind a quoted string or subshell.

**Compound command splitting**: `ls && rm -rf /` is split into individual parts, each prompted separately. The customer sees each sub-command with its own classification:

```
Part 1 of 2:  ls      [READ-ONLY]   → auto-allowed by rule
Part 2 of 2:  rm -rf  [DESTRUCTIVE] → prompted
```

**Classification categories**:
| Category | Color | Examples |
|----------|-------|----------|
| READ-ONLY | Green | ls, cat, grep, git status |
| WRITE | Yellow | cp, mv, mkdir, git commit |
| DESTRUCTIVE | Red | rm, kill, dd, git reset --hard |
| NETWORK | Cyan | curl, wget, ssh, ping |
| INTERACTIVE | Orange | vim, nano, python, tmux |
| UNKNOWN | Gray | anything else |

**Permission rules** use structured syntax:
- `bash(ls:*)` — allow any command starting with `ls`
- `bash(git:*)` — allow any git command
- `bash(*)` — allow any simple (non-compound) command

Rules are stored per-session in SQLite — approving `git` for one engineer doesn't carry over to another session.

### What's blocked by default

- Every command requires explicit approval — even `ls`
- Compound commands are always split and prompted per-part
- Proxy commands (`sudo`, `env`, `xargs`) are classified by their inner command
- Path-qualified commands (`/bin/rm`) are stripped to the base name
- No "allow all" for compound commands — each part must pass individually

### Interactive Commands

When a command is classified as **INTERACTIVE** (vim, python, mysql, etc.), the client gets a choice:

```
How would you like to handle this?
 ❯ I'll interact myself — You control the terminal
   Let engineer interact — Engineer controls, you watch
   Deny — Don't run this command
```

**Client interacts**: The child process gets direct terminal access (`stdio: 'inherit'`). Full vim/nano/tmux support. The engineer sees a status indicator while the client works.

**Engineer interacts**: A real PTY is created via `node-pty`. The engineer's keystrokes are relayed over SSE to the client's PTY, and output is streamed back. The client sees the live terminal output on their screen. The engineer sees stripped text output in their TUI. Press **Ctrl+]** to detach from the interactive session (like telnet).

## Secret Sharing

Share secrets with end-to-end encryption — the server only ever sees ciphertext.

```
 Sender (Server TUI)                              Recipient
 ┌─────────────────────────────────┐
 │                                 │
 │  Ctrl+S → type secret → Enter  │
 │                                 │
 │  ✓ Secret encrypted (35 bytes) │
 │                                 │
 │  Recipient command:             │               curl ... | openssl ...
 │    curl -sf ... | openssl ...   │  ──────────►  MY_API_KEY=sk-prod-abc
 │                                 │
 │  ✓ Retrieved by 203.0.113.42   │               (decrypted locally,
 │  Secret destroyed from memory.  │                key never sent to server)
 └─────────────────────────────────┘
```

### How it works

1. Secret is encrypted with AES-256-CBC using a random key
2. The encrypted blob is stored in memory (never touches disk)
3. The recipient gets a one-liner with the fetch URL and the decryption key
4. The URL fetches the encrypted blob — the decryption key stays local
5. After first retrieval the secret is destroyed from memory

**ngrok can't read your secrets** — the tunnel only sees ciphertext. The decryption key is in the command the recipient runs, never sent to the server.

### From the TUI

Press **Ctrl+S** in the server TUI to open the secret sharing panel. Type your secret, press Enter. The retrieval command is auto-copied to your clipboard.

### Standalone mode

```bash
echo "API_KEY=sk-live-abc123" | shellshock-share
cat .env | shellshock-share
shellshock-share --port 5000 --ttl 30
```

### Retrieving a secret

The recipient runs the one-liner — no install needed, just `curl` + `openssl`:

```bash
curl -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" https://<url>/s/<id> | openssl enc -aes-256-cbc -d -a -md sha256 -pass pass:<key> 2>/dev/null
```

Or via the helper script:

```bash
curl -sL shellshock.sh/secret | bash -s -- <url> <key>
```

### Security properties

- **End-to-end encrypted** — AES-256-CBC, OpenSSL-compatible format
- **Memory only** — nothing written to disk, no database, no logs
- **Burn after reading** — destroyed after first retrieval
- **Auto-expiry** — defaults to 15 minutes (configurable with `--ttl`)
- **Split-token** — auth ID authenticates the request, decryption key stays client-side
- **Bot protection** — requires `X-Shellshock: 1` header. Link preview bots (WhatsApp, Slack, Discord) won't trigger retrieval.

## Installation

```bash
npm install -g shellshock.sh      # server (for the engineer)
npm install -g shellshock-client   # client (for the customer)
```

Or use `npx` to run without installing:

```bash
npx shellshock.sh                  # start the server
npx shellshock-client <url>        # connect as a client
```

### From source

```bash
git clone https://github.com/0x0elliot/shellshock.sh.git
cd shellshock.sh
npm install
npm run build
```

## Usage

### Start the server

```bash
shellshock --port 4800 --host 0.0.0.0
```

Options:
- `--port <number>` — default 4800
- `--host <address>` — default 0.0.0.0
- `--no-tui` — headless mode (no terminal UI)

The server TUI shows a session list and command output. Press **Ctrl+N** to create a new session — the connect command is auto-copied to your clipboard.

### Connect a client

```bash
shellshock-client "http://host:port/session/<id>?token=<token>"
```

The client TUI shows a permission prompt for every command the engineer sends.

### Server shortcuts

| Key | Action |
|-----|--------|
| Ctrl+N | Create new session |
| Ctrl+S | Share a secret |
| Ctrl+D (×2) | Close active session |
| ↑↓ | Switch sessions |
| Escape | Cancel running/pending commands |
| Ctrl+C | Kill all running commands + quit |

### Client shortcuts

| Key | Action |
|-----|--------|
| ↑↓ | Navigate prompt options |
| Enter | Confirm selection |
| y/a/n | Quick approve/pattern/deny |
| p | View/edit permission rules |
| q | Quit |
| Ctrl+C (×2) | Emergency exit |

## Session Lifecycle

- Sessions are created on the server and persist in SQLite
- Each session supports exactly 1 engineer + 1 client
- Sessions expire after 10 minutes of inactivity
- The server reaps expired sessions every 30 seconds
- Closed sessions are marked in the database but not deleted (audit trail)

## Tech Stack

- **Runtime**: Node.js
- **TUI**: [Ink 5](https://github.com/vadimdemedes/ink) (React for terminals)
- **Transport**: HTTP + Server-Sent Events (works over HTTP/1.1, /2, /3)
- **Database**: SQLite via better-sqlite3
- **Crypto**: Node.js built-in `crypto` module (RSA-2048, OAEP padding)

## License

MIT
