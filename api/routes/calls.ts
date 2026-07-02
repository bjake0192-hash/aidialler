import express, { Request, Response } from 'express';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, PHONE_NUMBER_FROM, DOMAIN } = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

router.post('/start', async (req: Request, res: Response) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  try {
    const outboundTwiML = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${DOMAIN}/media-stream" />
        </Connect>
      </Response>`;

    const call = await client.calls.create({
      from: PHONE_NUMBER_FROM || '',
      to: phoneNumber,
      twiml: outboundTwiML,
    });

    res.status(200).json({
      success: true,
      callSid: call.sid,
      message: 'Call initiated successfully',
    });
  } catch (error: any) {
    console.error('Twilio Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate call',
    });
  }
});

export default router;
