# MCP Bluehost IMAP Readonly

A local MCP server for Claude Desktop that can read email from a Bluehost-hosted IMAP mailbox. Read-only only: no sending, deleting, moving, or marking read.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Create a `.env` file (see `.env.example`) with:

- `IMAP_HOST`
- `IMAP_PORT` (default 993)
- `IMAP_SECURE` (true/false, default true)
- `IMAP_USER`
- `IMAP_PASS`
- `IMAP_MAILBOX` (default INBOX)
- `IMAP_TLS_REJECT_UNAUTHORIZED` (true/false, default true)
- `IMAP_CONNECT_TIMEOUT_MS` (optional, in ms)
- `IMAP_COMMAND_TIMEOUT_MS` (optional, in ms)

3) Run the server:

```bash
npm run start
```

## Claude Desktop configuration

Add this MCP server to your Claude Desktop config (Windows path hint: `%APPDATA%\\Claude\\claude_desktop_config.json`). Use `node` directly so npm doesn't write to stdout (which can break MCP stdio).

```json
{
  "mcpServers": {
    "mcp-bluehost-imap-readonly": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.js", "server.ts"],
      "cwd": "<ABSOLUTE_PATH_TO_REPO>"
    }
  }
}
```

## Recommended Claude instructions

To make this feel seamless for end users, add the following instructions in Claude Desktop (Project Instructions or Custom Instructions) so Claude always uses the tools when the user asks about email.

```
You have access to an MCP server named "mcp-bluehost-imap-readonly" with tools:
- search_emails
- get_email
- list_recent_emails
- imap_healthcheck

When a user asks any question about email (orders, quotes, invoices, customers, shipments, etc.), ALWAYS use search_emails to find candidates, then get_email on the most relevant UID(s) to answer. Do not guess; if nothing is found, say so and suggest refining the query.
```

## Tools

- `imap_healthcheck` tests IMAP connectivity and returns mailbox names.
- `list_recent_emails` lists recent messages and returns metadata + snippet.
- `get_email` fetches a single message by UID and returns a cleaned body.
- `search_emails` searches subject/from/to/text and returns metadata + snippet.

Example prompts:

- "use list_recent_emails limit=5"
- "use get_email uid=12345"
- "use search_emails query='Harbor Nose' limit=10"
- "use search_emails subject='purchase order' since='2024-01-01' matchAll=true"

## Troubleshooting

- Verify IMAP host/port and SSL requirements for your Bluehost mailbox.
- If auth fails, confirm your username/password and mailbox permissions.
- For SSL issues, ensure `IMAP_SECURE=true` and port 993.
