#!/usr/bin/env python3
"""Somali AI Academy chat backend.

Python 3 stdlib only — no pip dependencies. Binds to 127.0.0.1 and sits
behind nginx (see nginx-chat.conf.snippet). Requires ANTHROPIC_API_KEY in
the environment (see /etc/somaliai-chat.env + somaliai-chat.service).
"""
import json
import os
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("CHAT_PORT", "8787"))
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("CHAT_MODEL", "claude-haiku-4-5-20251001")
MAX_TOKENS = 512
MAX_HISTORY = 12          # messages of context kept per request
MAX_MSG_CHARS = 2000      # per-message cap
RATE_PER_MIN = 8          # per-IP requests per minute
RATE_PER_DAY = 80         # per-IP requests per day

SYSTEM_PROMPT = """You are the friendly assistant of Somali AI Academy (somaliaiacademy.com), a school that teaches practical AI in Somali and English.

LANGUAGE: Mirror the user's language. If they write Somali, answer mainly in Af-Soomaali (simple and clear) with English technical terms where natural. If they write English, answer in English. Keep answers SHORT — 2 to 6 sentences, chat style. Many users are beginners reading on a phone.

YOUR JOB:
1) Teach: answer questions about AI, ChatGPT, prompts, images, voice, automation, making money with AI, and how to start learning.
2) Guide people to the academy when relevant (helpful, never pushy). These are the ONLY offers, with exact prices and links:
   - FREE: "AI Starter Pack" ($0) — 10 ready-to-use prompts (Somali-English), ChatGPT quick-start guide, 5 AI tools to try, make-money-with-AI ideas. Link: https://somaliaiacademy.gumroad.com/l/rdfsbe
   - $19 one-time: "AI Toolkit for Somali Entrepreneurs" — 30+ prompts for business, content & money, step-by-step setup guides, templates you can copy, lifetime updates. Link: https://somaliaiacademy.gumroad.com/l/zwfuxv
   - $49: "AI Masterclass — Af Soomaali" — a complete video course in Somali. It is NOT released yet (coming soon). Tell people to subscribe on YouTube: https://youtube.com/@SomaliAIAcademy
   - Paying with EVC Plus (Somali mobile money): send the money to 0617307059 (Magaca / Name: Abdishakur Mohamed), then email the payment screenshot and the product name to info@somaliaiacademy.com. Prices: Toolkit $19, Masterclass $49.
   - Business services (AI setup done for you: AI customer replies, content & marketing, admin automation, team training): email info@somaliaiacademy.com
   - YouTube channel: https://youtube.com/@SomaliAIAcademy

STRICT RULES:
- NEVER invent products, prices, discounts, refunds, guarantees, or bundles that are not listed above. If asked about something not listed, say you are not sure and point them to info@somaliaiacademy.com.
- Never promise specific earnings ("you will make $X"). Say results depend on effort and practice.
- Never ask for passwords, card numbers, ID documents, or other sensitive personal data.
- If a question is completely unrelated to AI, learning, or the academy, answer politely in one short sentence and steer back to learning AI.
- Be warm and encouraging, like a good teacher."""


# ---- per-IP rate limiting (in-memory sliding windows) ----
_minute = defaultdict(deque)
_day = defaultdict(deque)


def _allowed(ip):
    now = time.time()
    m, d = _minute[ip], _day[ip]
    while m and now - m[0] > 60:
        m.popleft()
    while d and now - d[0] > 86400:
        d.popleft()
    if len(m) >= RATE_PER_MIN or len(d) >= RATE_PER_DAY:
        return False
    m.append(now)
    d.append(now)
    return True


def _call_claude(messages):
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "system": SYSTEM_PROMPT,
            "messages": messages,
        }).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    return "".join(
        block.get("text", "")
        for block in out.get("content", [])
        if block.get("type") == "text"
    ).strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "SomaliAIChat/1.0"

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _client_ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def do_GET(self):
        if self.path == "/api/health":
            return self._json(200, {"ok": True, "model": MODEL})
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/api/chat":
            return self._json(404, {"error": "not_found"})
        if not _allowed(self._client_ip()):
            return self._json(429, {"error": "rate_limited"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 30000:
                return self._json(413, {"error": "too_large"})
            data = json.loads(self.rfile.read(length).decode("utf-8"))

            clean = []
            for m in list(data.get("messages", []))[-MAX_HISTORY:]:
                role = "user" if m.get("role") == "user" else "assistant"
                text = str(m.get("content", ""))[:MAX_MSG_CHARS].strip()
                if not text:
                    continue
                # collapse accidental same-role runs so the API accepts them
                if clean and clean[-1]["role"] == role:
                    clean[-1]["content"] += "\n" + text
                else:
                    clean.append({"role": role, "content": text})
            while clean and clean[0]["role"] != "user":
                clean.pop(0)
            if not clean or clean[-1]["role"] != "user":
                return self._json(400, {"error": "bad_request"})

            reply = _call_claude(clean)
            if not reply:
                return self._json(502, {"error": "empty_reply"})
            return self._json(200, {"reply": reply})
        except urllib.error.HTTPError as e:
            return self._json(502, {"error": "upstream", "status": e.code})
        except (urllib.error.URLError, TimeoutError):
            return self._json(504, {"error": "upstream_timeout"})
        except (ValueError, KeyError):
            return self._json(400, {"error": "bad_request"})
        except Exception:
            return self._json(500, {"error": "server_error"})

    def log_message(self, fmt, *args):  # keep journal quiet; errors still raise
        pass


if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit("ANTHROPIC_API_KEY is not set — refusing to start.")
    print(f"somaliai-chat listening on 127.0.0.1:{PORT} (model {MODEL})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
