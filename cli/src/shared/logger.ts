/**
 * Aegis CLI — Terminal-native logger
 *
 * Provides clean, prefixed output for the CLI.
 * Uses ANSI colors for production-quality terminal experience.
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';

function prefix(tag: string, color: string): string {
  return `${color}${BOLD}[${tag}]${RESET}`;
}

export const log = {
  chaos(msg: string): void {
    console.log(`${prefix('chaos', MAGENTA)} ${msg}`);
  },

  verify(msg: string): void {
    console.log(`${prefix('verify', CYAN)} ${msg}`);
  },

  next(msg: string): void {
    console.log(`${prefix('next', GREEN)} ${msg}`);
  },

  fix(msg: string): void {
    console.log(`${prefix('fix', YELLOW)} ${msg}`);
  },

  success(msg: string): void {
    console.log(`${prefix('✓', GREEN)} ${msg}`);
  },

  error(msg: string): void {
    console.error(`${prefix('error', RED)} ${msg}`);
  },

  debug(msg: string): void {
    if (process.argv.includes('--debug')) {
      console.log(`${DIM}[debug] ${msg}${RESET}`);
    }
  },

  blank(): void {
    console.log('');
  },
};
