import express, { Request, Response } from 'express';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { supabase } from '../lib/supabase.js';

dotenv.config();

const router = express.Router();
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, PHONE_NUMBER_FROM, DOMAIN } = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

router.post('/start', async (req: Request, res: Response) => {
  const { phoneNumber, name } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  try {
    // 1. Create or get lead in Supabase
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .upsert({ phone_number: phoneNumber, status: 'calling' }, { onConflict: 'phone_number' })
      .select()
      .single();

    if (leadError) throw leadError;

    // Strip http:// or https:// from DOMAIN just in case it was added by mistake
    const cleanDomain = DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // 2. Initiate Twilio call
    const outboundTwiML = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${cleanDomain}/media-stream" />
        </Connect>
      </Response>`;

    console.log(`Generated TwiML: ${outboundTwiML}`);

    const call = await client.calls.create({
      from: PHONE_NUMBER_FROM || '',
      to: phoneNumber,
      twiml: outboundTwiML,
    });

    // 3. Create call log
    const { error: logError } = await supabase
      .from('call_logs')
      .insert({
        lead_id: lead.id,
        twilio_sid: call.sid,
        transcript: ''
      });

    if (logError) console.error('Error creating call log:', logError);

    res.status(200).json({
      success: true,
      callSid: call.sid,
      leadId: lead.id,
      message: 'Call initiated successfully',
    });
  } catch (error: any) {
    console.error('Call Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate call',
    });
  }
});

// Route to get leads with their most recent call log
router.get('/leads', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*, call_logs(*)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Process data to flatten call_logs if needed or just send as is
    const processedLeads = data.map(lead => ({
      ...lead,
      transcript: lead.call_logs?.[0]?.transcript || '',
    }));

    res.status(200).json({ success: true, leads: processedLeads });
  } catch (error: any) {
    console.error('Fetch Leads Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
