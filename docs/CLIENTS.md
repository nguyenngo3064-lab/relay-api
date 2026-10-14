# Configuring Cline / OpenCode

HUAN RELAY exposes an OpenAI-compatible endpoint. Point your client at HUAN
RELAY and use the **master key** - never a provider API key.

1. In the dashboard, open **Master key** and create the key (it is auto-created
   after you add your first provider API key). Copy the raw key immediately; it
   is shown only once. The gateway load-balances across every enabled provider,
   so one key works for all models.
2. Configure your client:

   - **Base URL / API base:** `https://relay.example.com/v1` (your deployed
     HUAN RELAY endpoint, including `/v1`).
   - **API key:** the HUAN RELAY master key (`hrel_...`).
   - **Model:** optional with the master key. Any configured model id works,
     e.g. `nvidia/nemotron-3-ultra`.

## Cline

In Cline's API settings, choose the **OpenAI Compatible** provider and set:

- Base URL: `https://relay.example.com/v1`
- API Key: `hrel_...` (master key)
- Model ID: `nvidia/nemotron-3-ultra`

## OpenCode

Use an OpenAI-compatible provider entry pointing to your relay base URL with
the master key, and select a permitted model id.

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
- Rotate the master key from the dashboard (**Master key** -> Rotate) if it may
  have been exposed; the old key is revoked immediately.
