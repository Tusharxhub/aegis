'use client';

import { Shield, Wifi, WifiOff, Clock, Activity } from 'lucide-react';

interface HeaderProps {
  connected: boolean;
  uptime: number;
  nodeCount: number;
  crashCount: number;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function Header({
  connected,
  uptime,
  nodeCount,
  crashCount,
}: HeaderProps) {
  return (
    <header className="relative z-20 flex items-center justify-between px-6 py-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          {connected && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#05060f] status-healthy" />
          )}
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            AEGIS
          </h1>
          <p className="text-[11px] font-medium tracking-widest text-indigo-400/70 uppercase">
            Infrastructure Guardian
          </p>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-5">
        {/* Connection Status */}
        <div className="glass flex items-center gap-2 px-3 py-1.5 rounded-full">
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-400" />
          )}
          <span
            className={`text-xs font-medium ${
              connected ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {connected ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        {/* Uptime */}
        <div className="glass flex items-center gap-2 px-3 py-1.5 rounded-full">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-mono text-slate-300">
            {formatUptime(uptime)}
          </span>
        </div>

        {/* Node Count */}
        <div className="glass flex items-center gap-2 px-3 py-1.5 rounded-full">
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-medium text-slate-300">
            {nodeCount} node{nodeCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Crash Counter */}
        {crashCount > 0 && (
          <div className="glass flex items-center gap-2 px-3 py-1.5 rounded-full border-red-500/30 glow-danger">
            <span className="w-2 h-2 rounded-full bg-red-500 status-crashed" />
            <span className="text-xs font-medium text-red-400">
              {crashCount} crash{crashCount !== 1 ? 'es' : ''}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
