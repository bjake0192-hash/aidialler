import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import dotenv from 'dotenv';
import { supabase } from './lib/supabase.js';

dotenv.config();

// Helper functions for audio conversion
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
You are an AI sales assistant for OpenLead. Your goal is to qualify prospects for our lead generation services. 
Be professional, friendly, and concise. 

Script/Instructions:
1. Greet the prospect and introduce yourself as an AI assistant from OpenLead.
2. Ask if they have a moment to talk about their current lead generation process.
3. Ask if they are looking for more high-quality leads for their business.
4. If they seem interested, tell them that someone from our team will follow up soon and mark them as 'qualified'.
5. If they are not interested, thank them for their time and mark them as 'rejected'.
6. At the end of the call, provide a brief summary of the conversation.

Qualification Keywords:
- If interested: 'qualified', 'interested', 'follow up', 'yes'
- If not interested: 'rejected', 'not interested', 'no', 'stop calling'
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
          voice: 'alloy',
          instructions: AI_SCRIPT,
          modalities: ["text", "audio"],
          temperature: 0.8,
          input_audio_transcription: { model: 'whisper-1' }
        }
      };
      console.log('Sending session update to OpenAI with pcm16 format');
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
            content: [{
              type: 'text',
              text: 'Hello! I am an AI assistant from OpenLead calling to see if you are interested in high-quality leads for your business. How are you today?'
            }]
          }
        };
        openAiWs.send(JSON.stringify(greeting));
        // We don't need response.create if we just want the AI to "know" it said this, 
        // but if we want it to SPEAK it, we need to trigger a response or use a different method.
        // Actually, to make it speak a specific text, we can use conversation.item.create with a message
        // and then response.create.
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
          
          // Convert PCM16 from OpenAI back to Mu-law for Twilio
          const pcmBuffer = Buffer.from(response.delta, 'base64');
          const mulawBuffer = pcmToMulaw(pcmBuffer);
          
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
              
              // Convert Mu-law from Twilio to PCM16 for OpenAI
              const mulawBuffer = Buffer.from(data.media.payload, 'base64');
              const pcmBuffer = mulawToPcm(mulawBuffer);
              
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: pcmBuffer.toString('base64')
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
