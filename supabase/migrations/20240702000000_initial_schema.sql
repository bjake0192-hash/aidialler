-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    qualification_summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create call_logs table
CREATE TABLE IF NOT EXISTS call_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES leads(id),
    twilio_sid TEXT,
    transcript TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL PRIVILEGES ON leads TO authenticated;
GRANT ALL PRIVILEGES ON call_logs TO authenticated;
GRANT ALL PRIVILEGES ON leads TO anon;
GRANT ALL PRIVILEGES ON call_logs TO anon;

-- Policies
CREATE POLICY "Enable all for everyone on leads" ON leads FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for everyone on call_logs" ON call_logs FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
