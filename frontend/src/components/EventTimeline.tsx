'use client';

import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import type { WsContainerCrashPayload } from '@/types';

interface EventTimelineProps {
  events: WsContainerCrashPayload[];
}

function timeAgo(ts: string): string {
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="glass-elevated p-6 h-full flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-500/50" />
        </div>
        <p className="text-sm text-slate-400 font-medium">All Systems Nominal</p>
        <p className="text-xs text-slate-600 mt-1">No crash events detected</p>
      </div>
    );
  }

  return (
    <div className="glass-elevated p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Event Timeline</h2>
        </div>
        <span className="text-[10px] font-mono text-slate-500">{events.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {events.slice(0, 20).map((evt, i) => (
          <div key={`${evt.eventId}-${i}`} className="group flex items-start gap-3 p-3 rounded-xl bg-slate-800/30 hover:bg-slate-800/50 transition-all border border-transparent hover:border-slate-700/30">
            <div className="mt-0.5 shrink-0">
              <div className={`w-2 h-2 rounded-full ${evt.event.eventType === 'oom' ? 'bg-red-500 status-crashed' : 'bg-orange-500'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-white truncate">{evt.event.containerName}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${evt.event.eventType === 'oom' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'}`}>{evt.event.eventType}</span>
                <span className="ml-auto text-[10px] text-slate-600 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />{timeAgo(evt.timestamp)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span className="font-mono">exit:{evt.event.exitCode}</span>
                <span className="truncate">{evt.event.imageName}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
