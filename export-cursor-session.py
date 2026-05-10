#!/usr/bin/env python3
"""Export Cursor composer sessions from .vscdb, including MCP tool calls/results."""

import json
import sqlite3
import sys
import os
from pathlib import Path
from datetime import datetime

DB_PATH = Path.home() / ".config/Cursor/User/globalStorage/state.vscdb"


def get_db():
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)


def list_sessions(db, filter_text=None):
    cur = db.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
    sessions = []
    for key, value in cur:
        if not value:
            continue
        try:
            d = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            continue
        composer_id = d.get("composerId", key.split(":")[-1])
        headers = d.get("fullConversationHeadersOnly", [])
        status = d.get("status", "?")

        first_bubble_key = f"bubbleId:{composer_id}:{headers[0]['bubbleId']}" if headers else None
        first_text = ""
        created = ""
        if first_bubble_key:
            row = db.execute("SELECT value FROM cursorDiskKV WHERE key=?", (first_bubble_key,)).fetchone()
            if row:
                bd = json.loads(row[0])
                first_text = bd.get("text", "")[:80]
                created = bd.get("createdAt", "")

        has_mcp = False
        if filter_text:
            has_mcp = any(filter_text.lower() in json.dumps(d).lower() for _ in [1])
        else:
            has_mcp = "mcp" in value.lower() or "toolFormerData" in value

        sessions.append({
            "id": composer_id,
            "bubbles": len(headers),
            "status": status,
            "first_msg": first_text,
            "created": created,
            "has_mcp": has_mcp,
        })

    sessions.sort(key=lambda s: s["created"], reverse=True)
    return sessions


def export_session(db, composer_id):
    row = db.execute(
        "SELECT value FROM cursorDiskKV WHERE key=?",
        (f"composerData:{composer_id}",)
    ).fetchone()
    if not row:
        print(f"Session {composer_id} not found", file=sys.stderr)
        sys.exit(1)

    meta = json.loads(row[0])
    headers = meta.get("fullConversationHeadersOnly", [])

    messages = []
    for h in headers:
        bubble_id = h["bubbleId"]
        bubble_type = h.get("type", 0)
        brow = db.execute(
            "SELECT value FROM cursorDiskKV WHERE key=?",
            (f"bubbleId:{composer_id}:{bubble_id}",)
        ).fetchone()
        if not brow:
            continue

        bd = json.loads(brow[0])

        msg = {
            "role": "user" if bubble_type == 1 else "assistant",
            "bubbleId": bubble_id,
            "createdAt": bd.get("createdAt", ""),
        }

        text = bd.get("text", "")
        if text:
            msg["text"] = text

        thinking = bd.get("thinking", {})
        if thinking and thinking.get("text"):
            msg["thinking"] = thinking["text"]

        tf = bd.get("toolFormerData")
        if tf:
            tool_call = {
                "name": tf.get("name", ""),
                "status": tf.get("status", ""),
            }
            try:
                tool_call["params"] = json.loads(tf["params"]) if isinstance(tf.get("params"), str) else tf.get("params")
            except (json.JSONDecodeError, TypeError):
                tool_call["params"] = tf.get("params")

            try:
                tool_call["result"] = json.loads(tf["result"]) if isinstance(tf.get("result"), str) else tf.get("result")
            except (json.JSONDecodeError, TypeError):
                tool_call["result"] = tf.get("result")

            msg["toolCall"] = tool_call

        tool_results = bd.get("toolResults", [])
        if tool_results:
            msg["toolResults"] = tool_results

        code_blocks = bd.get("codeBlocks", [])
        if code_blocks:
            msg["codeBlocks"] = code_blocks

        suggested_diffs = bd.get("assistantSuggestedDiffs", [])
        if suggested_diffs:
            msg["suggestedDiffs"] = suggested_diffs

        messages.append(msg)

    return {
        "composerId": composer_id,
        "status": meta.get("status"),
        "messageCount": len(messages),
        "messages": messages,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  export-cursor-session.py list [filter]   — list sessions (optionally filter by text)")
        print("  export-cursor-session.py export <id>     — export session to JSON")
        print("  export-cursor-session.py export <id> -o file.json")
        sys.exit(1)

    cmd = sys.argv[1]
    db = get_db()

    if cmd == "list":
        filter_text = sys.argv[2] if len(sys.argv) > 2 else None
        sessions = list_sessions(db, filter_text)
        for s in sessions:
            mcp_flag = " [MCP]" if s["has_mcp"] else ""
            created = s["created"][:19] if s["created"] else "?"
            print(f'{s["id"]}  {created}  {s["bubbles"]:3d} msgs  {s["status"]:10s}{mcp_flag}  {s["first_msg"]}')
        print(f"\n{len(sessions)} sessions total")

    elif cmd == "export":
        if len(sys.argv) < 3:
            print("Provide a composer ID", file=sys.stderr)
            sys.exit(1)
        composer_id = sys.argv[2]
        data = export_session(db, composer_id)

        out_file = None
        if "-o" in sys.argv:
            idx = sys.argv.index("-o")
            if idx + 1 < len(sys.argv):
                out_file = sys.argv[idx + 1]

        output = json.dumps(data, indent=2, ensure_ascii=False)
        if out_file:
            Path(out_file).write_text(output)
            print(f"Exported {data['messageCount']} messages to {out_file}")
        else:
            print(output)
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)

    db.close()


if __name__ == "__main__":
    main()
