'use client';

import { useRef, useEffect, useState } from 'react';
import { Terminal, X, Minimize2, Maximize2 } from 'lucide-react';
import type { WsTerminalLog } from '@/types';

interface LiveTerminalProps {
  logs: WsTerminalLog[];
  aiStream: Map<string, string>;
  isOpen: boolean;
  onClose: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-slate-500',
  ai: 'text-purple-400',
};

const LEVEL_BADGES: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warn: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  debug: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  ai: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}

export default function LiveTerminal({
  logs,
  aiStream,
  isOpen,
  onClose,
}: LiveTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, aiStream]);

  if (!isOpen) return null;

  const activeStreamEntries = Array.from(aiStream.entries()).filter(
    ([, content]) => content.length > 0,
  );

  return (
    <div
      className={`
        fixed z-50 transition-all duration-500 ease-out
        ${
          isMaximized
            ? 'inset-4'
            : 'bottom-6 right-6 w-[640px] h-[420px]'
        }
      `}
    >
      <div className="glass-terminal h-full flex flex-col overflow-hidden">
        {/* Title Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/30">
          <div className="flex items-center gap-3">
            {/* Traffic lights */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
                aria-label="Close terminal"
              />
              <button
                onClick={() => setIsMaximized(false)}
                className="w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-400 transition-colors"
                aria-label="Minimize terminal"
              />
              <button
                onClick={() => setIsMaximized(!isMaximized)}
                className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-400 transition-colors"
                aria-label="Maximize terminal"
              />
            </div>
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs font-medium text-slate-400">
                Aegis Live Terminal
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1 rounded hover:bg-slate-700/50 transition-colors"
              aria-label="Toggle size"
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-slate-700/50 transition-colors"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Terminal Content */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
        >
          {logs.length === 0 && activeStreamEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Terminal className="w-8 h-8 text-slate-700 mb-3" />
              <p className="text-sm text-slate-600">
                Waiting for infrastructure events...
              </p>
              <p className="text-xs text-slate-700 mt-1">
                Crash events will appear here in real-time
              </p>
            </div>
          ) : (
            <>
              {/* Log Lines */}
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="terminal-line flex items-start gap-2 group"
                >
                  <span className="text-[10px] text-slate-700 font-mono shrink-0 mt-0.5">
                    {formatTime(log.timestamp)}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 font-medium uppercase tracking-wider ${LEVEL_BADGES[log.level] ?? LEVEL_BADGES.info}`}
                  >
                    {log.level === 'ai' ? 'AI' : log.level.slice(0, 4)}
                  </span>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    [{log.source}]
                  </span>
                  <span
                    className={`text-[12px] ${LEVEL_COLORS[log.level] ?? 'text-slate-400'}`}
                  >
                    {log.message}
                  </span>
                </div>
              ))}

              {/* Active AI Streams */}
              {activeStreamEntries.map(([eventId, content]) => (
                <div
                  key={eventId}
                  className="mt-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/10"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400 status-analyzing" />
                    <span className="text-[10px] font-medium text-purple-400 uppercase tracking-wider">
                      AI Reasoning Stream
                    </span>
                  </div>
                  <pre className="text-[12px] font-mono text-purple-300/80 whitespace-pre-wrap leading-relaxed">
                    {content}
                    <span className="terminal-cursor" />
                  </pre>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-700/20 flex items-center justify-between">
          <span className="text-[10px] text-slate-700">
            {logs.length} log entries
          </span>
          <span className="text-[10px] text-slate-700 font-mono">
            aegis@guardian:~$
            <span className="terminal-cursor" />
          </span>
        </div>
      </div>
    </div>
  );
}
