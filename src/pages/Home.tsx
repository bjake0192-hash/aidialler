import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Phone, 
  Users, 
  CheckCircle2, 
  TrendingUp, 
  BarChart3, 
  Settings as SettingsIcon, 
  LayoutDashboard,
  Play,
  History
} from 'lucide-react';

const stats = [
  { label: 'Total Calls', value: '1,284', icon: Phone, color: 'text-blue-400' },
  { label: 'Qualified Leads', value: '432', icon: CheckCircle2, color: 'text-emerald-400' },
  { label: 'Active Prospects', value: '892', icon: Users, color: 'text-indigo-400' },
  { label: 'Conversion Rate', value: '33.6%', icon: TrendingUp, color: 'text-cyan-400' },
];

const mockLeads = [
  { id: 1, name: 'John Doe', phone: '+1 234 567 890', status: 'Qualified', time: '2m ago' },
  { id: 2, name: 'Sarah Smith', phone: '+1 987 654 321', status: 'Calling', time: 'Just now' },
  { id: 3, name: 'Michael Brown', phone: '+1 555 012 345', status: 'Pending', time: '1h ago' },
  { id: 4, name: 'Emma Wilson', phone: '+1 444 987 654', status: 'Rejected', time: '3h ago' },
];

export default function Home() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCalling, setIsCalling] = useState(false);

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
      console.log('Call response:', data);
    } catch (error) {
      console.error('Call error:', error);
    } finally {
      setIsCalling(false);
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
            { icon: LayoutDashboard, label: 'Dashboard', active: true },
            { icon: Users, label: 'Leads' },
            { icon: History, label: 'Call History' },
            { icon: SettingsIcon, label: 'Settings' },
          ].map((item) => (
            <button
              key={item.label}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${
                item.active 
                  ? 'bg-white/10 text-white glow-border' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-auto">
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

        {/* Stats Grid */}
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

        {/* Leads Table */}
        <div className="glass-card overflow-hidden">
          <div className="p-6 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-xl font-bold">Recent Leads</h2>
            <button className="text-indigo-400 hover:text-indigo-300 text-sm font-medium">View all</button>
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
              {mockLeads.map((lead) => (
                <tr key={lead.id} className="group hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4 font-medium">{lead.name}</td>
                  <td className="px-6 py-4 text-slate-400">{lead.phone}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      lead.status === 'Qualified' ? 'bg-emerald-400/10 text-emerald-400' :
                      lead.status === 'Calling' ? 'bg-blue-400/10 text-blue-400 animate-pulse' :
                      lead.status === 'Rejected' ? 'bg-rose-400/10 text-rose-400' :
                      'bg-slate-400/10 text-slate-400'
                    }`}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-sm">{lead.time}</td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-slate-400 hover:text-white transition-colors">
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
