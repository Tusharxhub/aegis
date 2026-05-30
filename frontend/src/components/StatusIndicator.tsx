'use client';

import type { ServiceStatus } from '@/types';

interface StatusIndicatorProps {
  status: ServiceStatus;
  isAnalyzing?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const STATUS_CONFIG: Record<
  ServiceStatus,
  { color: string; label: string; pulseClass: string }
> = {
  HEALTHY: {
    color: 'bg-emerald-400',
    label: 'Healthy',
    pulseClass: 'status-healthy',
  },
  DEGRADED: {
    color: 'bg-yellow-400',
    label: 'Degraded',
    pulseClass: 'status-restarting',
  },
  CRASHED: {
    color: 'bg-red-500',
    label: 'Crashed',
    pulseClass: 'status-crashed',
  },
  RESTARTING: {
    color: 'bg-amber-400',
    label: 'Restarting',
    pulseClass: 'status-restarting',
  },
  UNKNOWN: {
    color: 'bg-slate-500',
    label: 'Unknown',
    pulseClass: '',
  },
};

const SIZE_MAP = {
  sm: 'w-2 h-2',
  md: 'w-3 h-3',
  lg: 'w-4 h-4',
};

export default function StatusIndicator({
  status,
  isAnalyzing = false,
  size = 'md',
}: StatusIndicatorProps) {
  const config = isAnalyzing
    ? { color: 'bg-purple-400', label: 'Analyzing', pulseClass: 'status-analyzing' }
    : STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded-full ${config.color} ${SIZE_MAP[size]} ${config.pulseClass}`}
      />
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
        {config.label}
      </span>
    </div>
  );
}
