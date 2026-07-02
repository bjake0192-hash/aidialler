# Debug Session: ai-dialler-silence-bug

## Status: [OPEN]

## Symptoms
- Outbound call connects but there is total silence.
- Call status in dashboard stays as "calling" even after the call ends.

## Hypotheses
1. **[H1] OpenAI Connection Failure**: The WebSocket connection to OpenAI is not opening or is being rejected.
2. **[H2] Message Format Mismatch**: Twilio's binary/buffer messages are not being parsed correctly for relay to OpenAI.
3. **[H3] Audio Relay Logic Error**: The `media` event from Twilio or `response.output_audio.delta` from OpenAI is not being received or forwarded.
4. **[H4] Greeting Trigger Failure**: The AI greeting is not being triggered or the AI is not generating audio for it.

## Evidence Collection Plan
1. Start Debug Server to collect runtime logs.
2. Instrument `api/media-stream.ts` to log:
   - Twilio WebSocket connection events (`connection`, `message`, `close`).
   - OpenAI WebSocket connection events (`open`, `message`, `error`, `close`).
   - Audio packet flow (start/stop/media events).
3. Instrument `api/routes/calls.ts` to log the generated TwiML URL.

## Timeline
- **2026-07-02 21:00**: Initialized debug session and hypotheses.
- **2026-07-02 21:10**: Analyzed logs. Found `invalid_request_error` from OpenAI: `The Realtime Beta API is no longer supported. Please use /v1/realtime for the GA API.`
- **2026-07-02 21:12**: Updated `media-stream.ts` to use GA endpoint and removed `OpenAI-Beta` header. [H1] was partially true (connection opened but was immediately closed due to error).
- **2026-07-02 21:15**: Found that `gpt-4o-realtime-preview` was not recognized without the full version string. Updated to `gpt-4o-realtime-preview-2024-10-01`.
- **2026-07-02 21:32**: Still getting `model_not_found`. Reverting to `gpt-4o-realtime-preview` but keeping the GA endpoint. Checking API key integrity.
