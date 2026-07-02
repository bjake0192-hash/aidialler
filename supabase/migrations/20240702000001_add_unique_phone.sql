-- Add unique constraint to phone_number in leads table
ALTER TABLE leads ADD CONSTRAINT leads_phone_number_key UNIQUE (phone_number);
