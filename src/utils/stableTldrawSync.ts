import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSyncDemo, RemoteTLStoreWithStatus } from '@tldraw/sync';
import { getDefaultUserPresence, TLPresenceUserInfo } from '@tldraw/tldraw';
import { getTldrawConfig } from '../config/tldrawConfig';

interface UseStableTldrawSyncOptions {
  roomId: string;
  userInfo: TLPresenceUserInfo;
  getUserPresence?: (store: any, user: TLPresenceUserInfo) => any;
  onConnectionChange?: (status: string) => void;
  connectionTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

interface UseStableTldrawSyncResult {
  store: RemoteTLStoreWithStatus | null;
  status: 'loading' | 'connected' | 'error' | 'connecting' | 'disconnected';
  error: Error | null;
  reconnect: () => void;
  connectionAttempts: number;
}

export function useStableTldrawSync({
  roomId,
  userInfo,
  getUserPresence,
  onConnectionChange,
  connectionTimeout,
  maxRetries,
  retryDelay
}: UseStableTldrawSyncOptions): UseStableTldrawSyncResult {
  // Get environment-specific configuration
  const config = getTldrawConfig();
  
  // Use provided values or fall back to config defaults
  const timeout = connectionTimeout ?? config.connection.timeout;
  const maxRetryAttempts = maxRetries ?? config.connection.maxRetries;
  const retryDelayMs = retryDelay ?? config.connection.retryDelay;
  const [status, setStatus] = useState<'loading' | 'connected' | 'error' | 'connecting' | 'disconnected'>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReconnecting = useRef(false);

  // Memoize userInfo to prevent infinite re-renders
  const stableUserInfo = useMemo(() => userInfo, [userInfo.id, userInfo.name, userInfo.color]);

  // Memoize getUserPresence function
  const stableGetUserPresence = useCallback((store: any, user: TLPresenceUserInfo) => {
    if (getUserPresence) {
      return getUserPresence(store, user);
    }
    
    // Default implementation
    const defaultPresence = getDefaultUserPresence(store, user);
    if (!defaultPresence) return null;

    return {
      ...defaultPresence,
      cursor: defaultPresence.cursor || { x: 0, y: 0, type: 'default', rotation: 0 },
    };
  }, [getUserPresence]);

  // Enhanced sync configuration with better cloud support
  const syncStore = useSyncDemo({
    roomId,
    userInfo: stableUserInfo,
    getUserPresence: stableGetUserPresence
  });

  // Connection monitoring and retry logic
  useEffect(() => {
    const handleConnectionChange = (newStatus: string) => {
      console.log('TLDraw sync status:', newStatus);
      onConnectionChange?.(newStatus);

      if (newStatus === 'synced-remote') {
        setStatus('connected');
        setError(null);
        setConnectionAttempts(0);
        isReconnecting.current = false;
        
        // Clear any existing timeouts
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
      } else if (newStatus === 'loading') {
        setStatus('connecting');
      } else if (newStatus === 'error') {
        setStatus('error');
        setError(syncStore.status === 'error' ? syncStore.error : new Error('Connection failed'));
        
        // Attempt retry if we haven't exceeded max retries
        if (connectionAttempts < maxRetryAttempts && !isReconnecting.current) {
          isReconnecting.current = true;
                      retryTimeoutRef.current = setTimeout(() => {
              console.log(`Retrying connection (attempt ${connectionAttempts + 1}/${maxRetryAttempts})`);
              setConnectionAttempts(prev => prev + 1);
              // Force a re-render to trigger new connection
              window.location.reload();
            }, retryDelayMs);
        }
      }
    };

    // Monitor sync store status
    if (syncStore.status === 'loading') {
      handleConnectionChange('loading');
    } else if (syncStore.status === 'error') {
      handleConnectionChange('error');
    } else if (syncStore.status === 'synced-remote') {
      handleConnectionChange('synced-remote');
    }

    // Set up connection timeout for cloud environments
    if (syncStore.status === 'loading') {
      timeoutRef.current = setTimeout(() => {
        if (syncStore.status === 'loading') {
          console.warn('Connection timeout, attempting to reconnect...');
          handleConnectionChange('error');
        }
      }, connectionTimeout);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
      }, [syncStore.status, connectionAttempts, maxRetryAttempts, retryDelayMs, timeout, onConnectionChange]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    console.log('Manual reconnect triggered');
    setConnectionAttempts(0);
    setError(null);
    setStatus('connecting');
    isReconnecting.current = false;
    
    // Clear existing timeouts
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // Force reconnection by reloading the page
    window.location.reload();
  }, []);

  return {
    store: syncStore.status === 'synced-remote' ? syncStore : null,
    status,
    error,
    reconnect,
    connectionAttempts
  };
}
