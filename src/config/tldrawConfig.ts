// TLDraw sync configuration for different environments
export const tldrawConfig = {
  // Connection settings optimized for cloud environments
  connection: {
    timeout: process.env.NODE_ENV === 'production' ? 45000 : 30000, // 45s for production, 30s for dev
    maxRetries: process.env.NODE_ENV === 'production' ? 8 : 5, // More retries for production
    retryDelay: process.env.NODE_ENV === 'production' ? 5000 : 3000, // Longer delays for production
    heartbeatInterval: 30000, // 30 seconds heartbeat
    reconnectDelay: 2000, // 2 seconds before reconnecting
  },
  
  // Presence settings
  presence: {
    updateInterval: 100, // Update presence every 100ms
    cursorUpdateInterval: 50, // Update cursor every 50ms
    maxPresenceAge: 60000, // Remove presence after 60 seconds of inactivity
  },
  
  // Sync settings
  sync: {
    batchSize: 100, // Number of changes to batch together
    compression: true, // Enable compression for network efficiency
    optimisticUpdates: true, // Apply updates optimistically
  },
  
  // Debug settings
  debug: {
    logConnectionEvents: process.env.NODE_ENV === 'development',
    logPresenceUpdates: false,
    logSyncEvents: process.env.NODE_ENV === 'development',
  }
};

// Environment-specific overrides
export const getTldrawConfig = () => {
  const isCloud = process.env.NODE_ENV === 'production' || 
                  (window.location.hostname !== 'localhost' && 
                   window.location.hostname !== '127.0.0.1');
  
  if (isCloud) {
    return {
      ...tldrawConfig,
      connection: {
        ...tldrawConfig.connection,
        timeout: 60000, // 60 seconds for cloud
        maxRetries: 10, // More retries for cloud
        retryDelay: 8000, // Longer delays for cloud
        heartbeatInterval: 45000, // 45 seconds heartbeat for cloud
      },
      presence: {
        ...tldrawConfig.presence,
        updateInterval: 200, // Slower updates for cloud
        cursorUpdateInterval: 100, // Slower cursor updates for cloud
      }
    };
  }
  
  return tldrawConfig;
};
