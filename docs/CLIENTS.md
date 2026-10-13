# Configuring Cline / OpenCode

HUAN RELAY exposes an OpenAI-compatible endpoint. Point your client at HUAN
RELAY and use a **HUAN RELAY client key** - never a provider API key.

1. In the dashboard, open **Client keys** and generate a key. Copy the raw key
   immediately; it is shown only once.
2. Configure your client:

   - **Base URL / API base:** `https://relay.example.com/v1` (your deployed
     HUAN RELAY endpoint, including `/v1`).
   - **API key:** the HUAN RELAY client key (`hrel_...`).
   - **Model:** a model id configured and enabled in HUAN RELAY, e.g.
     `nvidia/nemotron-3-ultra`.

## Cline

In Cline's API settings, choose the **OpenAI Compatible** provider and set:

- Base URL: `https://relay.example.com/v1`
- API Key: `hrel_...`
- Model ID: `nvidia/nemotron-3-ultra`

## OpenCode

Use an OpenAI-compatible provider entry pointing to your relay base URL with
the client key, and select a permitted model id.

## Verifying

```bash
curl https://relay.example.com/v1/chat/completions \
  -H "Authorization: Bearer hrel_..." \
  -H "content-type: application/json" \
  -d '{"model":"nvidia/nemotron-3-ultra","messages":[{"role":"user","content":"Reply with exactly: OK"}]}'
```

## Notes

- The client never needs or sees the provider API key.
- Streaming (`"stream": true`) is supported for OpenAI-compatible providers.
- If a model returns `MODEL_UNAVAILABLE`, confirm it is enabled on a provider in
  the dashboard and that a credential is saved.
- Rotate a client key from the dashboard if it may have been exposed; the old
  key is revoked immediately.
