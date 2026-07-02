import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import dotenv from 'dotenv';

dotenv.config();

const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment variables');
}

export function setupMediaStream(server: Server) {
  const wss = new WebSocketServer({ server, path: '/media-stream' });

  wss.on('connection', (connection: WebSocket) => {
    console.log('Twilio Media Stream connection established');

    let streamSid: string | null = null;
    const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const sendSessionUpdate = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: 'alloy',
          instructions: 'You are an AI sales assistant for OpenLead. Your goal is to qualify prospects for our lead generation services. Be professional, friendly, and concise. Ask about their current lead generation process and if they are looking for more high-quality leads.',
          modalities: ["text", "audio"],
          temperature: 0.8,
        }
      };
      console.log('Sending session update to OpenAI');
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    openAiWs.on('open', () => {
      console.log('Connected to OpenAI Realtime API');
      sendSessionUpdate();
    });

    openAiWs.on('message', (data: string) => {
      try {
        const response = JSON.parse(data);

        if (response.type === 'response.output_audio.delta' && response.delta && streamSid) {
          const audioDelta = {
            event: 'media',
            streamSid: streamSid,
            media: { payload: response.delta }
          };
          connection.send(JSON.stringify(audioDelta));
        }

        if (response.type === 'session.updated') {
          console.log('Session updated successfully');
        }

        if (response.type === 'error') {
          console.error('OpenAI Error:', response.error);
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error);
      }
    });

    connection.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'start':
            streamSid = data.start.streamSid;
            console.log(`Stream started with SID: ${streamSid}`);
            break;
          case 'media':
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case 'stop':
            console.log('Stream stopped');
            openAiWs.close();
            break;
        }
      } catch (error) {
        console.error('Error processing Twilio message:', error);
      }
    });

    connection.on('close', () => {
      console.log('Twilio connection closed');
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
