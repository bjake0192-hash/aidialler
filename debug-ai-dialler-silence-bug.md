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
