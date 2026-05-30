'use client';

import { Box, AlertTriangle, RefreshCw, Brain } from 'lucide-react';
import StatusIndicator from './StatusIndicator';
import type { ServiceNode } from '@/types';

interface NodeCardProps {
  node: ServiceNode;
  onClick: () => void;
}

export default function NodeCard({ node, onClick }: NodeCardProps) {
  const isCrashed = node.status === 'CRASHED';
  const isAnalyzing = node.isAnalyzing;

  const borderClass = isCrashed
    ? 'border-red-500/30 glow-danger'
    : isAnalyzing
      ? 'border-purple-500/30 glow-ai'
      : node.status === 'HEALTHY'
        ? 'border-emerald-500/10'
        : 'border-slate-500/10';

  return (
    <button
      onClick={onClick}
      className={`
        glass-elevated p-5 text-left transition-all duration-300
        hover:scale-[1.02] hover:border-indigo-500/30
        ${borderClass}
        ${isAnalyzing ? 'shimmer' : ''}
        animate-fade-in-up
        w-full
      `}
      id={`node-${node.containerId.slice(0, 8)}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`
              w-9 h-9 rounded-lg flex items-center justify-center
              ${
                isCrashed
                  ? 'bg-red-500/15 text-red-400'
                  : isAnalyzing
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'bg-indigo-500/15 text-indigo-400'
              }
            `}
          >
            {isAnalyzing ? (
              <Brain className="w-4.5 h-4.5 animate-pulse" />
            ) : isCrashed ? (
              <AlertTriangle className="w-4.5 h-4.5" />
            ) : node.status === 'RESTARTING' ? (
              <RefreshCw className="w-4.5 h-4.5 animate-spin" />
            ) : (
              <Box className="w-4.5 h-4.5" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white truncate max-w-[160px]">
              {node.name}
            </h3>
            <p className="text-[11px] text-slate-500 font-mono truncate max-w-[160px]">
              {node.imageName}
            </p>
          </div>
        </div>
        <StatusIndicator
          status={node.status}
          isAnalyzing={isAnalyzing}
          size="sm"
        />
      </div>

      {/* Exit Code */}
      {node.exitCode !== null && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
            Exit
          </span>
          <span
            className={`text-xs font-mono px-1.5 py-0.5 rounded ${
              node.exitCode === 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : node.exitCode === 137
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            {node.exitCode}
          </span>
          <span className="text-[10px] text-slate-600">
            {node.exitCode === 0
              ? 'Normal'
              : node.exitCode === 137
                ? 'OOM Kill'
                : node.exitCode === 139
                  ? 'Segfault'
                  : node.exitCode === 143
                    ? 'SIGTERM'
                    : 'Error'}
          </span>
        </div>
      )}

      {/* AI Analysis Preview */}
      {node.aiAnalysis && (
        <div className="mt-2 p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain className="w-3 h-3 text-purple-400" />
            <span className="text-[10px] font-medium text-purple-400 uppercase tracking-wider">
              AI Analysis
            </span>
            <span className="ml-auto text-[10px] font-mono text-purple-300/70">
              {(node.aiAnalysis.result.confidenceScore * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
            {node.aiAnalysis.result.analysis}
          </p>
        </div>
      )}

      {/* Analyzing Indicator */}
      {isAnalyzing && !node.aiAnalysis && (
        <div className="mt-2 p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10">
          <div className="flex items-center gap-2">
            <Brain className="w-3 h-3 text-purple-400 animate-pulse" />
            <span className="text-[11px] text-purple-300">
              AI is analyzing crash logs...
            </span>
          </div>
        </div>
      )}

      {/* Container ID */}
      <div className="mt-3 pt-2.5 border-t border-slate-700/30">
        <span className="text-[10px] font-mono text-slate-600">
          {node.containerId.slice(0, 12)}
        </span>
      </div>
    </button>
  );
}
