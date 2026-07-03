import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Phone, 
  Users, 
  CheckCircle2, 
  TrendingUp, 
  BarChart3, 
  Settings as SettingsIcon, 
  LayoutDashboard,
  Play,
  History,
  X,
  FileText,
  Clock,
  ExternalLink,
  PhoneOff
} from 'lucide-react';

interface Lead {
  id: string;
  phone_number: string;
  status: string;
  created_at: string;
  qualification_summary?: string;
  transcript?: string;
}

export default function Home() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCalling, setIsCalling] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState('Dashboard');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isEndingCall, setIsEndingCall] = useState<string | null>(null);

  const fetchLeads = async () => {
    try {
      const response = await fetch('/api/calls/leads');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setLeads(data.leads);
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleStartCall = async () => {
    if (!phoneNumber) return;
    setIsCalling(true);
    try {
      const response = await fetch('/api/calls/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await response.json();
      if (data.success) {
        fetchLeads();
      }
    } catch (error) {
      console.error('Call error:', error);
    } finally {
      setIsCalling(false);
      setPhoneNumber('');
    }
  };

  const handleEndCall = async (leadId: string) => {
    setIsEndingCall(leadId);
    try {
      const response = await fetch('/api/calls/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });
      if (response.ok) {
        fetchLeads();
      }
    } catch (error) {
      console.error('Error ending call:', error);
    } finally {
      setIsEndingCall(null);
    }
  };

  const stats = [
    { label: 'Total Calls', value: leads.length.toString(), icon: Phone, color: 'text-blue-400' },
    { label: 'Qualified Leads', value: leads.filter(l => l.status === 'qualified').length.toString(), icon: CheckCircle2, color: 'text-emerald-400' },
    { label: 'Active Prospects', value: leads.filter(l => l.status === 'calling').length.toString(), icon: Users, color: 'text-indigo-400' },
    { label: 'Conversion Rate', value: leads.length > 0 ? `${((leads.filter(l => l.status === 'qualified').length / leads.length) * 100).toFixed(1)}%` : '0%', icon: TrendingUp, color: 'text-cyan-400' },
  ];

  const renderContent = () => {
    console.log('Rendering content for tab:', currentTab);
    switch (currentTab) {
      case 'Dashboard':
        return (
          <>
            <header className="flex justify-between items-center mb-10">
              <div>
                <h1 className="text-3xl font-bold tracking-tight mb-1">Campaign Overview</h1>
                <p className="text-slate-400">Welcome back, here's what's happening today.</p>
              </div>
              <div className="flex gap-4">
                <div className="relative group">
                  <input
                    type="text"
                    placeholder="Enter phone number..."
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  />
                </div>
                <button
                  onClick={handleStartCall}
                  disabled={isCalling}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all glow-blue disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  {isCalling ? 'Initiating...' : 'Start AI Call'}
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="glass-card p-6 group hover:border-indigo-500/30 transition-all duration-300"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2 rounded-lg bg-white/5 ${stat.color}`}>
                      <stat.icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
                      +12%
                    </span>
                  </div>
                  <h3 className="text-slate-400 text-sm font-medium mb-1">{stat.label}</h3>
                  <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
                </motion.div>
              ))}
            </div>

            <div className="glass-card overflow-hidden">
              <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-bold">Recent Leads</h2>
                <button onClick={() => setCurrentTab('Leads')} className="text-indigo-400 hover:text-indigo-300 text-sm font-medium">View all</button>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-400 text-sm font-medium border-b border-white/5">
                    <th className="px-6 py-4">Lead</th>
                    <th className="px-6 py-4">Phone Number</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Time</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                          <span>Loading leads...</span>
                        </div>
                      </td>
                    </tr>
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        No leads found. Start a call to see them here.
                      </td>
                    </tr>
                  ) : (
                    leads.slice(0, 5).map((lead) => (
                      <tr key={lead.id} className="group hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 font-medium">Lead #{lead.id.slice(0, 8)}</td>
                        <td className="px-6 py-4 text-slate-400">{lead.phone_number}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            lead.status === 'qualified' ? 'bg-emerald-400/10 text-emerald-400' :
                            lead.status === 'calling' ? 'bg-blue-400/10 text-blue-400 animate-pulse' :
                            lead.status === 'rejected' ? 'bg-rose-400/10 text-rose-400' :
                            'bg-slate-400/10 text-slate-400'
                          }`}>
                            {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-sm">
                          {new Date(lead.created_at).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {lead.status === 'calling' && (
                              <button 
                                onClick={() => handleEndCall(lead.id)}
                                disabled={isEndingCall === lead.id}
                                className="text-rose-400 hover:text-rose-300 transition-colors flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                                title="End Call"
                              >
                                {isEndingCall === lead.id ? (
                                  <div className="w-3.5 h-3.5 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <PhoneOff className="w-3.5 h-3.5" />
                                )}
                                End Call
                              </button>
                            )}
                            <button 
                              onClick={() => setSelectedLead(lead)}
                              className="text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View Details
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Lead Details Modal */}
            <AnimatePresence>
              {selectedLead && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setSelectedLead(null)}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl bg-[#0a0f1d] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                  >
                    {/* Modal Header */}
                    <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          selectedLead.status === 'qualified' ? 'bg-emerald-400/10 text-emerald-400' :
                          selectedLead.status === 'calling' ? 'bg-blue-400/10 text-blue-400' :
                          'bg-slate-400/10 text-slate-400'
                        }`}>
                          <Phone className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold">Lead Details</h3>
                          <p className="text-sm text-slate-400">{selectedLead.phone_number}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setSelectedLead(null)}
                        className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-400 hover:text-white"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Modal Body */}
                    <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                      {/* Summary Section */}
                      <section>
                        <div className="flex items-center gap-2 mb-3 text-indigo-400">
                          <CheckCircle2 className="w-4 h-4" />
                          <h4 className="text-sm font-semibold uppercase tracking-wider">Qualification Summary</h4>
                        </div>
                        <div className="bg-white/5 border border-white/5 rounded-xl p-4 text-slate-300 leading-relaxed">
                          {selectedLead.qualification_summary || 'No summary available yet. The AI is still processing this lead.'}
                        </div>
                      </section>

                      {/* Transcript Section */}
                      <section>
                        <div className="flex items-center gap-2 mb-3 text-blue-400">
                          <FileText className="w-4 h-4" />
                          <h4 className="text-sm font-semibold uppercase tracking-wider">Call Transcript</h4>
                        </div>
                        <div className="bg-black/40 border border-white/5 rounded-xl p-4 font-mono text-sm text-slate-400 h-64 overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed">
                          {selectedLead.transcript || 'No transcript available for this call.'}
                        </div>
                      </section>

                      {/* Meta Info */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wider mb-1">
                            <Clock className="w-3 h-3" />
                            Created At
                          </div>
                          <div className="text-sm font-medium">
                            {new Date(selectedLead.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wider mb-1">
                            <TrendingUp className="w-3 h-3" />
                            Status
                          </div>
                          <div className={`text-sm font-bold uppercase ${
                            selectedLead.status === 'qualified' ? 'text-emerald-400' :
                            selectedLead.status === 'calling' ? 'text-blue-400' :
                            'text-slate-400'
                          }`}>
                            {selectedLead.status}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </>
        );
      case 'Leads':
        return (
          <div className="glass-card p-6">
            <h2 className="text-2xl font-bold mb-6">Lead Management</h2>
            <p className="text-slate-400">Manage and qualify your leads here.</p>
            {/* Full leads list could go here */}
          </div>
        );
      case 'History':
        return (
          <div className="glass-card p-6">
            <h2 className="text-2xl font-bold mb-6">Call History</h2>
            <p className="text-slate-400">Review past conversations and AI analysis.</p>
          </div>
        );
      case 'Settings':
        return (
          <div className="glass-card p-6">
            <h2 className="text-2xl font-bold mb-6">Settings</h2>
            <p className="text-slate-400">Configure your AI persona and Twilio integration.</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-50 flex bg-mesh">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-black/20 backdrop-blur-xl p-6 flex flex-col gap-8">
        <div className="flex items-center gap-2 px-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center glow-blue">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">OpenLead</span>
        </div>

        <nav className="flex flex-col gap-2">
          {[
            { icon: LayoutDashboard, label: 'Dashboard' },
            { icon: Users, label: 'Leads' },
            { icon: History, label: 'History' },
            { icon: SettingsIcon, label: 'Settings' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={(e) => {
                e.preventDefault();
                console.log('Tab clicked:', item.label);
                setCurrentTab(item.label);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 z-50 cursor-pointer ${
                currentTab === item.label 
                  ? 'bg-white/10 text-white glow-border' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon className="w-5 h-5 pointer-events-none" />
              <span className="font-medium pointer-events-none">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-auto">
        {renderContent()}
      </main>
    </div>
  );
}
