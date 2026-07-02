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
- Name: Sarah Edwards.
- Company: Open Energy Services (everyone calls it OES).
- Persona: Professional, friendly, British growth consultant. Use British English idioms (e.g., "brilliant", "lovely", "cheers").
- Tone: Real person, not a robot. Use natural fillers like "um", "ah", or "I see".

# CORE BEHAVIOR
- WAIT FOR THE USER TO SPEAK FIRST. When the user says "Hello" or answers the phone, you must reply with the INTRODUCTION.
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
          // Only pass English speech to the AI
          input_audio_transcription: { model: 'whisper-1', language: 'en' }
        }
      };
      
      // If the AI speaks Spanish, it's often because the "shimmer" voice was trained on multilingual data.
      // We will switch to "alloy" or "echo" which tend to be more stable in English.
      // Let's use "alloy" which is very clear and human-like.
      sessionUpdate.session.voice = 'alloy';
      console.log('Sending session update to OpenAI with strict English instructions');
      openAiWs.send(JSON.stringify(sessionUpdate));
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
            // Remove proactive greeting to let VAD trigger naturally when the user speaks.
            // The AI will now wait for the user to say "Hello" before speaking.
            console.log('Stream started. Waiting for user to speak...');
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
