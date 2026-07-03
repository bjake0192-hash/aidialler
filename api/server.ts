/**
 * local server entry file, for local development
 */
import app from './app.js';
import { setupMediaStream } from './media-stream.js';

// --- IN-MEMORY LOGGING FOR DEBUGGING ON RENDER ---
const MAX_LOGS = 200;
export const appLogs: string[] = [];

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function addLog(level: string, ...args: any[]) {
  const msg = `[${new Date().toISOString()}] [${level}] ` + args.map(a => 
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  
  appLogs.push(msg);
  if (appLogs.length > MAX_LOGS) appLogs.shift();
}

console.log = function(...args) {
  addLog('INFO', ...args);
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  addLog('ERROR', ...args);
  originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
  addLog('WARN', ...args);
  originalConsoleWarn.apply(console, args);
};
// -------------------------------------------------

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

// Setup WebSocket media stream
setupMediaStream(server);

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;