import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import dotenv from 'dotenv';
import { supabase } from './lib/supabase.js';

dotenv.config();

// Helper functions for audio conversion and resampling
function mulawToPcm(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    let u = ~mulaw[i];
    let sign = (u & 0x80);
    let exponent = (u & 0x70) >> 4;
    let mantissa = (u & 0x0F);
    let sample = (mantissa << 3) + 0x84;
    sample <<= (exponent);
    sample -= 0x84;
    pcm.writeInt16LE(sign ? -sample : sample, i * 2);
  }
  return pcm;
}

function pcmToMulaw(pcm: Buffer): Buffer {
  const mulaw = Buffer.alloc(pcm.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    let sample = pcm.readInt16LE(i * 2);
    let sign = (sample < 0) ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    sample += 0x84;
    if (sample > 32767) sample = 32767;
    let exponent = 0;
    let tmp = sample >> 7;
    while (tmp > 1) {
      tmp >>= 1;
      exponent++;
    }
    let mantissa = (sample >> (exponent + 3)) & 0x0F;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa);
  }
  return mulaw;
}

// Resample PCM16 from 8kHz to 24kHz (for OpenAI)
function resample8to24(pcm8k: Buffer): Buffer {
  const pcm24k = Buffer.alloc(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length / 2; i++) {
    const sample = pcm8k.readInt16LE(i * 2);
    // Basic linear interpolation to reduce noise that might trigger wrong language detection
    const nextSample = (i < (pcm8k.length / 2) - 1) ? pcm8k.readInt16LE(i * 2 + 2) : sample;
    
    pcm24k.writeInt16LE(sample, i * 6);
    pcm24k.writeInt16LE(Math.round(sample + (nextSample - sample) * (1/3)), i * 6 + 2);
    pcm24k.writeInt16LE(Math.round(sample + (nextSample - sample) * (2/3)), i * 6 + 4);
  }
  return pcm24k;
}

// Resample PCM16 from 24kHz to 8kHz (for Twilio)
function resample24to8(pcm24k: Buffer): Buffer {
  const pcm8k = Buffer.alloc(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length / 2; i++) {
    const sample = pcm24k.readInt16LE(i * 6);
    pcm8k.writeInt16LE(sample, i * 2);
  }
  return pcm8k;
}

const { OPENAI_API_KEY, DOMAIN } = process.env;
const API_KEY = OPENAI_API_KEY?.trim();

// #region debug-point ai-dialler-silence-bug-reporter
const reportDebug = (event: string, data: any = {}, hypothesisId?: string) => {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'ai-dialler-silence-bug',
      event,
      data,
      hypothesisId,
      timestamp: new Date().toISOString()
    })
  }).catch(() => {});
};
// #endregion

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment variables');
  process.exit(1);
}
const AI_SCRIPT = `
# PERSONALITY
You are Sarah, a friendly and professional growth consultant from OpenLead. 
You sound like a real person, not a robot. You use natural fillers like "um", "ah", or "I see" occasionally, and you show empathy.
YOU MUST SPEAK ONLY IN ENGLISH.

# OUTBOUND SCRIPT FLOW
1. **The Hook**: "Hey there! This is Sarah from OpenLead. I hope I'm not catching you at a bad time?"
   - If they say they are busy: "Totally understand. I'll be super brief—just 30 seconds?"
   - If they say yes/go ahead: "Great! I was just looking at your business and noticed you might be a good fit for what we're doing with AI-driven lead generation."

2. **The Question**: "Are you currently looking to bring in more high-quality leads, or is your sales team pretty maxed out right now?"
   - Listen carefully to their answer.

3. **Qualification**:
   - If they are interested: "That's awesome. Just so I can give you the best info, what industry are you primarily focused on right now?"
   - If they answer: "Got it. We've actually had a lot of success in that space. Our AI basically acts like a 24/7 prospector to find people who are actually ready to buy."

4. **The Close**:
   - "I'd love to have one of our specialists show you exactly how this could work for your specific setup. Would you be open to a quick 5-minute demo sometime later this week?"
   - If yes: "Perfect! I'll have someone reach out to coordinate that. It was great chatting with you!"
   - If no: "No worries at all. I appreciate you being upfront. Have a fantastic day!"

# GUIDELINES
- **Be Conversational**: Don't just read the script. React to what they say. If they sound tired, acknowledge it. If they are excited, match their energy.
- **Stay Focused**: Your only goal is to see if they want a demo for more leads.
- **Handling Rejection**: If they say "not interested," be extremely polite and end the call quickly.
- **Strictly English**: Even if you are being "natural", you must stay in English.

# QUALIFICATION MAPPING
- If they agree to a demo or show high interest: mark as "qualified".
- If they say "not interested", "no", or "remove me": mark as "rejected".
`;

export function setupMediaStream(server: Server) {
  const wss = new WebSocketServer({ server, path: '/media-stream' });

  wss.on('connection', (connection: WebSocket) => {
    // #region debug-point twilio-connection
    reportDebug('twilio-connection-established');
    // #endregion
    console.log('Twilio Media Stream connection established');

    let streamSid: string | null = null;
    let callSid: string | null = null;
    let transcript = '';
    let hasGreetingBeenSent = false;

    console.log(`Initiating OpenAI WebSocket connection with key starting with: ${API_KEY?.slice(0, 12)}...`);
    const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    openAiWs.on('unexpected-response', (req, res) => {
      console.error('OpenAI Unexpected Response:', res.statusCode, res.statusMessage);
      res.on('data', (chunk) => console.error('Response body:', chunk.toString()));
    });

    const updateCallLog = async (finalTranscript: string) => {
      if (callSid) {
        const { error } = await supabase
          .from('call_logs')
          .update({ transcript: finalTranscript })
          .eq('twilio_sid', callSid);
        
        if (error) console.error('Error updating call log:', error);
      }
    };

    const updateLeadStatus = async (status: string, summary: string = '') => {
      console.log(`Attempting to update lead status to ${status} for callSid: ${callSid}`);
      if (callSid) {
        // Get lead_id from call_logs
        const { data: log, error: fetchError } = await supabase
          .from('call_logs')
          .select('lead_id')
          .eq('twilio_sid', callSid)
          .single();
        
        if (fetchError) {
          console.error(`Error fetching call log for status update:`, fetchError);
          return;
        }

        if (log) {
          // Fetch current status to avoid overwriting final statuses
          const { data: currentLead } = await supabase
            .from('leads')
            .select('status')
            .eq('id', log.lead_id)
            .single();

          if (currentLead && (currentLead.status === 'calling' || status !== 'completed')) {
            const { error } = await supabase
              .from('leads')
              .update({ status, qualification_summary: summary })
              .eq('id', log.lead_id);
            
            if (error) console.error('Error updating lead status:', error);
            else console.log(`Lead status successfully updated to: ${status}`);
          } else {
            console.log(`Skipping status update to ${status} because current status is ${currentLead?.status}`);
          }
        } else {
          console.warn(`No call log found for callSid: ${callSid}`);
        }
      } else {
        console.warn('Cannot update lead status: callSid is null');
      }
    };

    const sendSessionUpdate = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          voice: 'shimmer',
          instructions: AI_SCRIPT,
          modalities: ["text", "audio"],
          temperature: 0.7,
          input_audio_transcription: { model: 'whisper-1', language: 'en' }
        }
      };
      console.log('Sending session update to OpenAI with strict English instructions');
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    const sendGreeting = () => {
      if (hasGreetingBeenSent || connection.readyState !== WebSocket.OPEN) {
        // #region debug-point greeting-skipped
        reportDebug('greeting-skipped', { hasGreetingBeenSent, connectionState: connection.readyState });
        // #endregion
        return;
      }
      
      if (openAiWs.readyState === WebSocket.OPEN) {
        // #region debug-point greeting-sent
        reportDebug('sending-greeting', {}, 'H4');
        // #endregion
        console.log('Sending AI greeting to OpenAI');
        const greeting = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'input_text',
              text: "Hey there! This is Sarah from OpenLead. I hope I'm not catching you at a bad time?"
            }
          ]
        }
      };
        openAiWs.send(JSON.stringify(greeting));
        openAiWs.send(JSON.stringify({ type: 'response.create' }));
        hasGreetingBeenSent = true;
      } else if (openAiWs.readyState === WebSocket.CONNECTING) {
        console.log('OpenAI WS connecting, retrying greeting in 500ms...');
        setTimeout(sendGreeting, 500);
      } else {
        console.error('OpenAI WS closed or in error state, cannot send greeting. State:', openAiWs.readyState);
      }
    };

    openAiWs.on('open', () => {
      // #region debug-point openai-open
      reportDebug('openai-connection-open', {}, 'H1');
      // #endregion
      console.log('Connected to OpenAI Realtime API');
      sendSessionUpdate();
    });

    openAiWs.on('message', (data: string) => {
      try {
        const response = JSON.parse(data);
        // #region debug-point openai-message
        if (response.type !== 'input_audio_buffer.append') {
          reportDebug('openai-message-received', { type: response.type, error: response.error });
        }
        // #endregion

        // Handle audio output from AI
        if (response.type === 'response.output_audio.delta' && response.delta && streamSid) {
          // #region debug-point ai-audio-out
          reportDebug('ai-audio-delta-sent', { length: response.delta.length }, 'H3');
          // #endregion
          
          // Convert PCM16 (24kHz) from OpenAI back to Mu-law (8kHz) for Twilio
          const pcm24kBuffer = Buffer.from(response.delta, 'base64');
          const pcm8kBuffer = resample24to8(pcm24kBuffer);
          const mulawBuffer = pcmToMulaw(pcm8kBuffer);
          
          const audioDelta = {
            event: 'media',
            streamSid: streamSid,
            media: { payload: mulawBuffer.toString('base64') }
          };
          connection.send(JSON.stringify(audioDelta));
        }

        // Handle text response for transcript
        if (response.type === 'response.audio_transcript.done') {
          transcript += `AI: ${response.transcript}\n`;
          updateCallLog(transcript);
        }

        if (response.type === 'conversation.item.input_audio_transcription.completed') {
          transcript += `User: ${response.transcript}\n`;
          updateCallLog(transcript);
        }

        // Handle qualification logic based on AI response
        if (response.type === 'response.done') {
          const text = response.response?.output?.[0]?.content?.[0]?.text || '';
          const lowerText = text.toLowerCase();
          
          if (lowerText.includes('qualified') || lowerText.includes('interested')) {
            updateLeadStatus('qualified', text);
          } else if (lowerText.includes('not interested') || lowerText.includes('rejected')) {
            updateLeadStatus('rejected', text);
          }
        }

        if (response.type === 'error') {
          console.error('OpenAI Error:', response.error);
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error);
      }
    });

    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        // #region debug-point twilio-message
        if (data.event !== 'media') {
          reportDebug('twilio-message-received', { event: data.event });
        }
        // #endregion

        switch (data.event) {
          case 'start':
            streamSid = data.start.streamSid;
            callSid = data.start.callSid;
            console.log(`Stream started with SID: ${streamSid}, Call SID: ${callSid}`);
            // Trigger greeting as soon as stream starts
            setTimeout(sendGreeting, 1000); 
            break;
          case 'media':
            if (openAiWs.readyState === WebSocket.OPEN) {
              // #region debug-point user-audio-in
              // reportDebug('user-audio-received', { length: data.media.payload.length });
              // #endregion
              
              // Convert Mu-law (8kHz) from Twilio to PCM16 (24kHz) for OpenAI
              const mulawBuffer = Buffer.from(data.media.payload, 'base64');
              const pcm8kBuffer = mulawToPcm(mulawBuffer);
              const pcm24kBuffer = resample8to24(pcm8kBuffer);
              
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: pcm24kBuffer.toString('base64')
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case 'stop':
            console.log('Twilio Media Stream stopped event received');
            updateCallLog(transcript);
            updateLeadStatus('completed', 'Call ended (stop event).');
            if (openAiWs.readyState === WebSocket.OPEN) {
              openAiWs.close();
            }
            break;
        }
      } catch (error) {
        console.error('Error processing Twilio message:', error);
      }
    });

    connection.on('close', () => {
      console.log('Twilio connection closed');
      updateCallLog(transcript);
      // Ensure status is updated if not already done
      updateLeadStatus('completed', 'Call ended (connection closed).');
      if (openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.close();
      }
    });

    openAiWs.on('close', () => {
      console.log('OpenAI connection closed');
    });

    openAiWs.on('error', (error) => {
      console.error('OpenAI WebSocket Error:', error);
    });
  });
}
