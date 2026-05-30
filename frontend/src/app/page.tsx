'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Server,
  Activity,
  Cpu,
  RefreshCw,
  Terminal as TerminalIcon,
  Database,
  ShieldAlert,
  Play,
  CheckCircle2,
  AlertTriangle,
  Info
} from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import LiveTerminal from '@/components/LiveTerminal';
import Header from '@/components/Header';
import type { WsTerminalLog } from '@/types';

interface Episode {
  _id: string;
  state_vector: number[];
  action_taken: number;
  reward: number;
  next_state_vector: number[];
  timestamp: string;
  containerName: string;
  imageName: string;
  exitCode: number;
  eventType: string;
}

interface FloatingReward {
  id: string;
  value: number;
  containerName: string;
}

export default function Home() {
  const {
    connected,
    uptime,
    nodes,
    terminalLogs,
    recentEvents,
    activeStreams,
  } = useSocket();

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingMessage, setTrainingMessage] = useState<string | null>(null);
  const [floatingRewards, setFloatingRewards] = useState<FloatingReward[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(true);
  
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  // Fetch initial episodes
  const fetchEpisodes = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/orchestrator/episodes`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data);
      }
    } catch (err) {
      console.error('Failed to fetch episodes:', err);
    }
  };

  useEffect(() => {
    fetchEpisodes();
  }, []);

  // Watch for socket event: completed event triggers re-fetch and floating reward
  useEffect(() => {
    const socket = (window as any).__aegis_socket__;
    if (!socket) return;

    const handleEpisodeSaved = (data: { containerName: string; reward: number }) => {
      // Add floating reward representation
      const newReward: FloatingReward = {
        id: Math.random().toString(),
        value: data.reward,
        containerName: data.containerName,
      };
      setFloatingRewards((prev) => [...prev, newReward]);
      fetchEpisodes();

      // Remove after 3 seconds
      setTimeout(() => {
        setFloatingRewards((prev) => prev.filter((r) => r.id !== newReward.id));
      }, 3000);
    };

    socket.on('rl:episode-saved', handleEpisodeSaved);
    socket.on('remediation:complete', fetchEpisodes);

    return () => {
      socket.off('rl:episode-saved', handleEpisodeSaved);
      socket.off('remediation:complete', fetchEpisodes);
    };
  }, [connected]);

  // Trigger manual training
  const handleTriggerTraining = async () => {
    setIsTraining(true);
    setTrainingMessage('Requesting training cycle from local SB3 engine...');
    try {
      const res = await fetch(`${apiUrl}/api/orchestrator/train`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setTrainingMessage(`✅ Training Succeeded! Processed: ${data.episodes_processed} episodes. Avg Reward: ${data.average_historical_reward.toFixed(2)}`);
        fetchEpisodes();
      } else {
        setTrainingMessage(`⚠️ Training skipped: ${data.message}`);
      }
    } catch (err: any) {
      setTrainingMessage(`❌ Failed to trigger training: ${err.message}`);
    } finally {
      setIsTraining(false);
      setTimeout(() => setTrainingMessage(null), 8000);
    }
  };

  const getActionLabel = (idx: number) => {
    const labels = ['DO_NOTHING', 'RESTART_CONTAINER', 'ROLLBACK_IMAGE', 'SCALE_INSTANCES'];
    return labels[idx] ?? 'UNKNOWN';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'HEALTHY':
        return 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5';
      case 'CRASHED':
        return 'text-red-400 border-red-500/20 bg-red-500/5';
      case 'RESTARTING':
        return 'text-amber-400 border-amber-500/20 bg-amber-500/5';
      case 'DEGRADED':
        return 'text-purple-400 border-purple-500/20 bg-purple-500/5';
      default:
        return 'text-slate-400 border-slate-500/20 bg-slate-500/5';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'HEALTHY':
        return 'bg-emerald-400 status-healthy';
      case 'CRASHED':
        return 'bg-red-400 status-crashed';
      case 'RESTARTING':
        return 'bg-amber-400 status-restarting';
      case 'DEGRADED':
        return 'bg-purple-400 status-analyzing';
      default:
        return 'bg-slate-400';
    }
  };

  return (
    <div className="min-h-screen grid-bg relative overflow-x-hidden font-sans">
      <div className="bg-mesh" />

      {/* Floating Rewards Container */}
      <div className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
        <AnimatePresence>
          {floatingRewards.map((reward) => (
            <motion.div
              key={reward.id}
              initial={{ opacity: 0, y: 50, scale: 0.8 }}
              animate={{ opacity: 1, y: -100, scale: 1.2 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 1.8, ease: 'easeOut' }}
              className={`px-6 py-3 rounded-full border shadow-2xl flex items-center gap-3 backdrop-blur-md font-mono text-sm font-semibold
                ${
                  reward.value > 0
                    ? 'border-emerald-500/30 bg-emerald-950/80 text-emerald-400 glow-success'
                    : 'border-red-500/30 bg-red-950/80 text-red-400 glow-danger'
                }`}
            >
              <Cpu className="w-4 h-4 animate-spin" />
              <span>
                {reward.containerName}: {reward.value > 0 ? `+${reward.value}` : reward.value} Reward
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Header
        connected={connected}
        uptime={uptime}
        nodeCount={nodes.length}
        crashCount={nodes.filter((n) => n.status === 'CRASHED').length}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8 pb-32">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="glass p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-mono">MDP EVAL WINDOW</p>
              <h3 className="text-xl font-bold mt-1 font-mono text-indigo-400">10s / 300s</h3>
            </div>
            <Activity className="w-8 h-8 text-indigo-500/40" />
          </div>
          
          <div className="glass p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-mono">REPLAY SAMPLES</p>
              <h3 className="text-xl font-bold mt-1 font-mono text-emerald-400">{episodes.length}</h3>
            </div>
            <Database className="w-8 h-8 text-emerald-500/40" />
          </div>

          <div className="glass p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-mono">RL MODEL POOL</p>
              <h3 className="text-xl font-bold mt-1 font-mono text-purple-400">PPO MLP</h3>
            </div>
            <Cpu className="w-8 h-8 text-purple-500/40" />
          </div>

          <div className="glass p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-mono">ACTIVE INSTANCES</p>
              <h3 className="text-xl font-bold mt-1 font-mono text-cyan-400">{nodes.length}</h3>
            </div>
            <Server className="w-8 h-8 text-cyan-500/40" />
          </div>
        </div>

        {/* Central Operations Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Infrastructure Topology Grid */}
          <div className="lg:col-span-2 glass p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Server className="text-indigo-400 w-5 h-5" />
                <h2 className="text-lg font-bold tracking-tight">Isolated Topology Graph</h2>
              </div>
              <button
                onClick={() => setTerminalOpen(!terminalOpen)}
                className="text-xs font-mono px-3 py-1.5 rounded-lg border border-slate-700/50 hover:bg-slate-700/20 text-slate-400 flex items-center gap-2 transition"
              >
                <TerminalIcon className="w-3.5 h-3.5" />
                Toggle Console
              </button>
            </div>

            {nodes.length === 0 ? (
              <div className="border border-dashed border-slate-800 rounded-xl py-16 text-center text-slate-500 font-mono text-sm">
                No external containers detected on Docker Socket.
                <br />
                <span className="text-xs text-slate-700">Aegis is waiting for docker daemon updates.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {nodes.map((node) => (
                  <motion.div
                    key={node.containerId}
                    layoutId={node.containerId}
                    className={`p-5 rounded-xl border relative overflow-hidden transition-all duration-300
                      ${
                        node.status === 'CRASHED'
                          ? 'border-red-500/30 bg-red-950/10 glow-danger'
                          : node.status === 'RESTARTING'
                          ? 'border-amber-500/30 bg-amber-950/10'
                          : 'border-slate-800 bg-slate-900/20'
                      }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-sm tracking-tight text-white">{node.name}</h4>
                        <p className="text-xs text-slate-500 font-mono mt-0.5 max-w-[200px] truncate">
                          {node.imageName}
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono tracking-wider ${getStatusColor(node.status)}`}>
                        {node.status}
                      </span>
                    </div>

                    {/* Vector array visual stream */}
                    {node.isAnalyzing && (
                      <div className="mt-4 p-2.5 rounded bg-purple-500/5 border border-purple-500/20 text-[9px] font-mono text-purple-400">
                        <span className="flex items-center gap-1.5 mb-1">
                          <Cpu className="w-3.5 h-3.5 animate-spin" /> Log Embeddings & Predict Vector Passing:
                        </span>
                        <div className="truncate text-purple-300">
                          {Array.from({ length: 25 }, () => (Math.random() * 2 - 1).toFixed(4)).join(', ')}...
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-800/60 text-xs text-slate-500 font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${getStatusDot(node.status)}`} />
                        <span>Socket IP Route</span>
                      </div>
                      <span>ID: {node.containerId.slice(0, 10)}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* AI Decision Hub */}
          <div className="glass p-6 space-y-6 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Cpu className="text-purple-400 w-5 h-5" />
                <h2 className="text-lg font-bold tracking-tight">AI & RL Weight Management</h2>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Project Aegis utilizes custom policies inside Stable Baselines3. Collected container crash trajectories are stored in MongoDB and analyzed. Models are retrained locally, optimizing action policies.
              </p>

              {/* Action Key Legend */}
              <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/20 space-y-2.5 text-xs font-mono">
                <p className="text-slate-500 font-bold border-b border-slate-900 pb-1.5">Policy Action Definitions:</p>
                <div className="flex justify-between text-slate-400">
                  <span>0 - DO NOTHING</span>
                  <span className="text-slate-600">Idle Check</span>
                </div>
                <div className="flex justify-between text-emerald-400">
                  <span>1 - RESTART CONTAINER</span>
                  <span className="text-slate-600">Docker Restart</span>
                </div>
                <div className="flex justify-between text-amber-400">
                  <span>2 - ROLLBACK IMAGE</span>
                  <span className="text-slate-600">Tag Pull & Rebuild</span>
                </div>
                <div className="flex justify-between text-cyan-400">
                  <span>3 - SCALE CONTAINER</span>
                  <span className="text-slate-600">Spin Replica</span>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-slate-800/40">
              <button
                onClick={handleTriggerTraining}
                disabled={isTraining}
                className={`w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition font-mono border
                  ${
                    isTraining
                      ? 'bg-purple-950/20 border-purple-500/20 text-purple-400 cursor-not-allowed'
                      : 'bg-indigo-600 border-indigo-500 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 hover:shadow-indigo-500/30'
                  }`}
              >
                <RefreshCw className={`w-4 h-4 ${isTraining ? 'animate-spin' : ''}`} />
                {isTraining ? 'Training Models...' : 'Trigger Manual Training'}
              </button>

              {trainingMessage && (
                <div className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-950/40 text-xs font-mono leading-relaxed text-indigo-300">
                  {trainingMessage}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Real-time Replay Matrix */}
        <div className="glass p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Database className="text-emerald-400 w-5 h-5" />
              <h2 className="text-lg font-bold tracking-tight">RL Episode Replay Matrix</h2>
            </div>
            <button
              onClick={fetchEpisodes}
              className="p-2 rounded-lg border border-slate-700/50 hover:bg-slate-700/20 text-slate-400 transition"
              title="Refresh logs"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-800/60 rounded-xl bg-slate-950/10">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/40 text-slate-400">
                  <th className="p-4 font-semibold">Timestamp</th>
                  <th className="p-4 font-semibold">Container</th>
                  <th className="p-4 font-semibold">Reason</th>
                  <th className="p-4 font-semibold">Action Selected</th>
                  <th className="p-4 font-semibold text-center">Reward Assigned</th>
                  <th className="p-4 font-semibold">State Dimensions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {episodes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-600">
                      Replay matrix is empty. Waiting for container events to feed the offline reinforcement learning buffer.
                    </td>
                  </tr>
                ) : (
                  episodes.map((episode) => (
                    <tr key={episode._id} className="hover:bg-slate-900/10 transition text-slate-300">
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        {new Date(episode.timestamp).toLocaleString()}
                      </td>
                      <td className="p-4 font-bold text-white whitespace-nowrap">
                        {episode.containerName}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold
                          ${episode.eventType === 'oom' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                          {episode.eventType} (Exit {episode.exitCode})
                        </span>
                      </td>
                      <td className="p-4 text-indigo-300 whitespace-nowrap">
                        {getActionLabel(episode.action_taken)}
                      </td>
                      <td className={`p-4 text-center font-bold text-sm whitespace-nowrap
                        ${episode.reward > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {episode.reward > 0 ? `+${episode.reward}` : episode.reward}
                      </td>
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        {episode.state_vector.length} dim vector
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* WebSocket Interactive Terminal */}
      <LiveTerminal
        logs={terminalLogs}
        aiStream={activeStreams}
        isOpen={terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />
    </div>
  );
}
