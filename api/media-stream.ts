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

// Resample PCM16 from 8kHz to 16kHz (for ElevenLabs)
function resample8to16(pcm8k: Buffer): Buffer {
  const pcm16k = Buffer.alloc(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length / 2; i++) {
    const sample = pcm8k.readInt16LE(i * 2);
    // Linear interpolation
    const nextSample = (i < (pcm8k.length / 2) - 1) ? pcm8k.readInt16LE(i * 2 + 2) : sample;
    
    pcm16k.writeInt16LE(sample, i * 4);
    pcm16k.writeInt16LE(Math.round(sample + (nextSample - sample) * 0.5), i * 4 + 2);
  }
  return pcm16k;
}

// Resample PCM16 from 16kHz to 8kHz (for Twilio)
function resample16to8(pcm16k: Buffer): Buffer {
  const pcm8k = Buffer.alloc(Math.floor(pcm16k.length / 2));
  for (let i = 0; i < pcm8k.length / 2; i++) {
    const sample = pcm16k.readInt16LE(i * 4);
    pcm8k.writeInt16LE(sample, i * 2);
  }
  return pcm8k;
}

const { ELEVENLABS_AGENT_ID, ELEVENLABS_API_KEY, DOMAIN } = process.env;
const API_KEY = ELEVENLABS_API_KEY?.trim();

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
- Name: Sarah Edwards.
- Company: Open Energy Services (everyone calls it OES).
- Persona: Professional, friendly, British growth consultant. 
- ACCENT: YOU MUST SPEAK WITH A CLEAR BRITISH ACCENT.
- Tone: Real person, not a robot. Use natural fillers like "um", "ah", or "I see".
- LANGUAGE: ENGLISH ONLY. Never use Arabic, Spanish, or any other language.

# CORE BEHAVIOR
- WAIT FOR THE USER TO SPEAK FIRST. 
- When the user says "Hello" or answers the phone, YOU MUST IMMEDIATELY REPLY EXACTLY WITH THE INTRODUCTION FROM STEP 1. DO NOT SAY ANYTHING ELSE FIRST.
- IF YOU HEAR SILENCE OR BACKGROUND NOISE, DO NOT RESPOND IN ARABIC. Assume the user is thinking.
- DO NOT repeat yourself. 
- If the user has answered a question, MOVE ON to the next step.
- If they say they are busy during the intro: "Totally understand. I'll be super brief—just 30 seconds?"
- If the conversation is finished, say goodbye and STOP TALKING.

# OUTBOUND SOLAR SCRIPT FLOW

1. **INTRODUCTION**
   "Hi, it's Sarah Edwards, I'm calling from OES. I was just reaching out regarding Solar for your Business premises... I was just wondering, is that something you're currently looking into?"

2. **DISCOVERY (If they are looking into it or open to talk)**
   Ask these questions one by one, reacting naturally:
   - "How much are you currently spending on electricity per month?"
   - "Are you on a commercial or domestic tariff? And what's your unit rate if you know it?"
   - "Do you own the premises, or is it a lease?" (If lease: Ask how long left, if they'll renew, and if they have permission for building changes).
   - "Are you on three phase, or single phase electricity?"
   - "What material is on the roof? And how's the condition—any cracks or leaks?"
   - (If skylights): "Are you happy to cover the skylights if it means an increased solar installation?"
   - "What payment options would you consider? CAPEX, finance, PPA, or open to all?"
   - "Who is your current energy provider? Is it only electric?"

3. **SPECIAL QUALIFICATION (Engineering & Extra Services)**
   - **Electrical Testing**: "Just because I know the engineer will ask, when did you have your electrical testing done? When does your EICR expire?" (If they don't know, explain it's an insurance requirement and our engineer can do it during the survey).
   - **HVAC**: "Just to check, do you have any HVAC systems or Air Conditioning units on site? Are they on the roof or side of the building?"
   - **Website Partnership**: "I couldn't find your website earlier—do you have one? We actually partner with a digital marketing agency that gives our clients big discounts. I can add that info to the email or have them give you a quote if you're keen?"

4. **CLOSE (Set the Scene)**
   "Brilliant, that's really helpful. The next step is for our surveyor to review your site in detail so we can create an accurate system and savings projection for you. To do this, we just need your energy bill. I'll stay on the line—could you email a copy to my direct email now?"

# QUALIFICATION MAPPING
- Mark as "qualified" if they are interested and willing to send a bill.
- Mark as "rejected" if they explicitly say no, not interested, or hang up.
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

    console.log(`Initiating ElevenLabs WebSocket connection with Agent ID: ${ELEVENLABS_AGENT_ID}`);
    let elevenLabsWs: WebSocket | null = null;

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

    const setupElevenLabs = async () => {
      try {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
          { headers: { 'xi-api-key': API_KEY || '' } }
        );
        
        if (!response.ok) {
          console.error('Failed to get ElevenLabs signed URL:', await response.text());
          return;
        }
        
        const data = await response.json();
        elevenLabsWs = new WebSocket(data.signed_url);

        elevenLabsWs.on('open', () => {
          console.log('Connected to ElevenLabs Conversational AI');
        });

        elevenLabsWs.on('message', (data: string) => {
          try {
            const msg = JSON.parse(data);
            
            // Handle audio from ElevenLabs
            if (msg.type === 'audio' && msg.audio_event?.audio_base_64) {
              if (streamSid) {
                // ElevenLabs sends PCM16 at 16kHz
                const pcm16kBuffer = Buffer.from(msg.audio_event.audio_base_64, 'base64');
                const pcm8kBuffer = resample16to8(pcm16kBuffer);
                const mulawBuffer = pcmToMulaw(pcm8kBuffer);
                
                connection.send(JSON.stringify({
                  event: 'media',
                  streamSid: streamSid,
                  media: { payload: mulawBuffer.toString('base64') }
                }));
              }
            } 
            // Handle transcriptions
            else if (msg.type === 'agent_response') {
              const text = msg.agent_response_event?.agent_response;
              if (text) {
                console.log(`Agent: ${text}`);
                transcript += `Agent: ${text}\n`;
                updateCallLog(transcript);
                
                // Simple qualification check
                const lowerText = text.toLowerCase();
                if (lowerText.includes('qualified') || lowerText.includes('interested')) {
                  updateLeadStatus('qualified', text);
                } else if (lowerText.includes('not interested') || lowerText.includes('rejected')) {
                  updateLeadStatus('rejected', text);
                }
              }
            } else if (msg.type === 'user_transcript') {
              const text = msg.user_transcription_event?.user_transcript;
              if (text) {
                console.log(`User: ${text}`);
                transcript += `User: ${text}\n`;
                updateCallLog(transcript);
              }
            }
          } catch (error) {
            console.error('Error processing ElevenLabs message:', error);
          }
        });

        elevenLabsWs.on('close', () => {
          console.log('Disconnected from ElevenLabs');
        });

        elevenLabsWs.on('error', (error) => {
          console.error('ElevenLabs WebSocket error:', error);
        });

      } catch (error) {
        console.error('Error setting up ElevenLabs:', error);
      }
    };

    setupElevenLabs();

    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.event) {
          case 'start':
            streamSid = data.start.streamSid;
            callSid = data.start.callSid;
            console.log(`Stream started with SID: ${streamSid}, Call SID: ${callSid}`);
            break;
          case 'media':
            if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
              // Convert Mu-law (8kHz) from Twilio to PCM16 (16kHz) for ElevenLabs
              const mulawBuffer = Buffer.from(data.media.payload, 'base64');
              const pcm8kBuffer = mulawToPcm(mulawBuffer);
              const pcm16kBuffer = resample8to16(pcm8kBuffer);
              
              elevenLabsWs.send(JSON.stringify({
                user_audio_chunk: pcm16kBuffer.toString('base64')
              }));
            }
            break;
          case 'stop':
            console.log('Twilio Media Stream stopped event received');
            updateCallLog(transcript);
            updateLeadStatus('completed', 'Call ended (stop event).');
            if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
              elevenLabsWs.close();
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
      updateLeadStatus('completed', 'Call ended (connection closed).');
      if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        elevenLabsWs.close();
      }
    });
  });
}
