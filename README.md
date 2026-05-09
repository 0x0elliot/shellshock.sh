# shellshock.sh

Remote debugging and secret sharing over the terminal. Nothing runs without a yes, nothing leaks in transit.

**Remote debugging**: a support engineer can securely request shell commands on a customer's machine. Every command requires explicit customer approval through a terminal UI.

**Secret sharing**: share API keys, tokens, and credentials end-to-end encrypted. The decryption key never reaches the server, so even over ngrok, the middleman can't read your secrets. Burns after first retrieval.

## Install

```bash
npm install -g shellshock.sh      # server (for the engineer)
npm install -g shellshock-client   # client (for the customer)
```

Or run without installing:

```bash
npx -p shellshock.sh shellshock                  # start the server
npx -p shellshock-client shellshock-client <url>  # connect as a client
```

### From source

```bash
git clone https://github.com/0x0elliot/shellshock.sh.git
cd shellshock.sh
npm install && npm run build
```

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
                   │  (in-memory) │
                   └──────────────┘
```

<!-- TODO: add screenshot of server TUI in action -->

## Command Safety

Commands are classified by risk level and shown with a colored badge so the customer knows what they're approving:

| Category | Color | Examples |
|----------|-------|----------|
| READ-ONLY | Green | ls, cat, grep, git status |
| WRITE | Yellow | cp, mv, mkdir, git commit |
| DESTRUCTIVE | Red | rm, kill, dd, git reset --hard |
| NETWORK | Cyan | curl, wget, ssh, ping |
| INTERACTIVE | Orange | vim, nano, python, tmux |
| UNKNOWN | Gray | anything else |

Compound commands like `ls && rm -rf /` are split into individual parts, each prompted separately with its own classification. Proxy commands (`sudo`, `env`, `xargs`) are classified by their inner command.

Permission rules use structured syntax: `bash(ls:*)` allows any command starting with `ls`, `bash(git:*)` allows any git command. Rules are stored per-session in SQLite on the client side — approving `git` for one session doesn't carry over to another.

When a command is classified as **INTERACTIVE** (vim, python, mysql), the customer chooses: run it yourself with direct terminal access, or let the engineer drive remotely via a PTY relay. Press **Ctrl+]** to detach from a remote interactive session.

<!-- TODO: add screenshot of client permission prompt -->

## Security

- **RSA-2048 handshake** — every session starts with a challenge-response before any commands can flow
- **AES-256 session encryption** — all messages are encrypted after the handshake with a client-generated session key
- **Per-command approval** — every command requires explicit customer consent, even `ls`
- **No server persistence** — sessions, commands, and keys are held in-memory only; nothing survives a restart
- **Compound splitting** — `ls && rm -rf /` is never approved as a single unit

## Secret Sharing

Press **Ctrl+S** in the server TUI to encrypt and share a secret. The secret is encrypted with AES-256-CBC using a random key, stored in memory, and destroyed after first retrieval. The recipient runs a one-liner — no install needed:

```bash
curl -sf -H "X-Shellshock: 1" -H "ngrok-skip-browser-warning: 1" \
  https://<url>/s/<id> | openssl enc -aes-256-cbc -d -a -md sha256 -pass pass:<key> 2>/dev/null
```

- **End-to-end encrypted** — the decryption key is in the command, never sent to the server
- **Memory only** — nothing written to disk, no database, no logs
- **Burn after reading** — destroyed after first retrieval
- **Auto-expiry** — defaults to 15 minutes (configurable with `--ttl`)

## Usage

### Start the server

```bash
shellshock --port 4800 --host 0.0.0.0
```

`--port <number>` (default 4800), `--host <address>` (default 0.0.0.0), `--no-tui` (headless mode).

### Connect a client

```bash
shellshock-client "http://host:port/session/<id>?token=<token>"
```

The server TUI shows a session list and command output. Press **Ctrl+N** to create a new session — the connect command is auto-copied to your clipboard.

## Tech Stack

- **Runtime**: Node.js
- **TUI**: [Ink 5](https://github.com/vadimdemedes/ink) (React for terminals)
- **Transport**: HTTP + Server-Sent Events
- **Crypto**: Node.js built-in `crypto` (RSA-2048, AES-256-CBC)
- **Storage**: In-memory on server; SQLite (client-side only, for permission rules)

## License

MIT
