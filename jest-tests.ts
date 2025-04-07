// helpers.test.ts
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { loadCredentials, SVIDMonitor } from '../helpers';

// Mock fs and chokidar
jest.mock('fs');
jest.mock('chokidar');

describe('helpers.js tests', () => {
  // Store original environment variables
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset mocks before each test
    jest.resetAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  describe('loadCredentials', () => {
    it('should load credentials successfully when files exist', () => {
      // Mock fs.readFileSync to return test data
      (fs.readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('svid.0.pem')) return 'mock-cert';
        if (path.includes('svid.0.key')) return 'mock-key';
        if (path.includes('bundle.0.pem')) return 'mock-ca';
        throw new Error(`Unexpected path: ${path}`);
      });
      
      // Mock fs.existsSync to return true
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const credentials = loadCredentials();
      
      // Verify credentials were loaded correctly
      expect(credentials).toEqual({
        cert: 'mock-cert',
        key: 'mock-key',
        ca: 'mock-ca',
        requestCert: true,
        rejectUnauthorized: true
      });
      
      // Verify fs.readFileSync was called with correct paths
      expect(fs.readFileSync).toHaveBeenCalledWith('/run/spire/x509svid/svid.0.pem');
      expect(fs.readFileSync).toHaveBeenCalledWith('/run/spire/x509svid/svid.0.key');
      expect(fs.readFileSync).toHaveBeenCalledWith('/run/spire/x509svid/bundle.0.pem');
    });

    it('should return null when file reading fails', () => {
      // Mock fs.readFileSync to throw an error
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });
      
      // Mock console.error to prevent test output pollution
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const credentials = loadCredentials();
      
      // Verify null was returned
      expect(credentials).toBeNull();
      
      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading credentials: File not found');
      expect(consoleLogSpy).toHaveBeenCalledWith('Retrying in 5 seconds...');
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should use environment variables for paths when provided', () => {
      // Set custom paths in environment variables
      process.env.SVID_CERT_PATH = '/custom/cert/path';
      process.env.SVID_KEY_PATH = '/custom/key/path';
      process.env.SVID_BUNDLE_PATH = '/custom/bundle/path';
      
      // Mock fs.readFileSync to return test data
      (fs.readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path === '/custom/cert/path') return 'custom-cert';
        if (path === '/custom/key/path') return 'custom-key';
        if (path === '/custom/bundle/path') return 'custom-ca';
        throw new Error(`Unexpected path: ${path}`);
      });
      
      const credentials = loadCredentials();
      
      // Verify credentials were loaded from custom paths
      expect(credentials).toEqual({
        cert: 'custom-cert',
        key: 'custom-key',
        ca: 'custom-ca',
        requestCert: true,
        rejectUnauthorized: true
      });
      
      // Verify fs.readFileSync was called with correct paths
      expect(fs.readFileSync).toHaveBeenCalledWith('/custom/cert/path');
      expect(fs.readFileSync).toHaveBeenCalledWith('/custom/key/path');
      expect(fs.readFileSync).toHaveBeenCalledWith('/custom/bundle/path');
    });
  });

  describe('SVIDMonitor', () => {
    it('should initialize and start monitoring when files exist', () => {
      // Mock fs.existsSync to return true
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      
      // Mock chokidar.watch to return a mock watcher
      const mockWatcher = {
        on: jest.fn().mockReturnThis(),
        close: jest.fn()
      };
      (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);
      
      // Create test callback
      const onUpdateCallback = jest.fn();
      
      // Create and initialize SVIDMonitor
      const monitor = new SVIDMonitor(onUpdateCallback);
      const result = monitor.init();
      
      // Verify chokidar.watch was called with correct paths
      expect(chokidar.watch).toHaveBeenCalledWith([
        '/run/spire/x509svid/svid.0.pem',
        '/run/spire/x509svid/svid.0.key',
        '/run/spire/x509svid/bundle.0.pem'
      ], expect.any(Object));
      
      // Verify watcher events were registered
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
      
      // Verify monitor returned itself for chaining
      expect(result).toBe(monitor);
    });

    it('should wait for file creation when files do not exist', () => {
      // Mock fs.existsSync to return false (files don't exist yet)
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      
      // Mock chokidar.watch to return a mock watcher
      const mockWatcher = {
        on: jest.fn().mockReturnThis(),
        close: jest.fn()
      };
      (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);
      
      // Create test callback
      const onUpdateCallback = jest.fn();
      
      // Create and initialize SVIDMonitor
      const monitor = new SVIDMonitor(onUpdateCallback);
      const result = monitor.init();
      
      // Verify chokidar.watch was called with directory path
      expect(chokidar.watch).toHaveBeenCalledWith('/run/spire/x509svid', expect.any(Object));
      
      // Verify watcher events were registered
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      
      // Verify monitor returned itself for chaining
      expect(result).toBe(monitor);
    });

    it('should trigger onUpdate callback when file changes are detected', () => {
      // Mock fs.existsSync to return true
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      
      // Mock chokidar.watch to return a mock watcher with event triggers
      let changeCallback: Function;
      const mockWatcher = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'change') {
            changeCallback = callback;
          }
          return mockWatcher;
        }),
        close: jest.fn()
      };
      (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);
      
      // Create test callback
      const onUpdateCallback = jest.fn();
      
      // Create and initialize SVIDMonitor
      const monitor = new SVIDMonitor(onUpdateCallback);
      monitor.start();
      
      // Simulate file change event
      changeCallback('/run/spire/x509svid/svid.0.pem');
      
      // Verify onUpdate callback was called
      expect(onUpdateCallback).toHaveBeenCalled();
    });
  });
});

// server.test.ts
import * as https from 'https';
import { ServerManager } from '../server';
import { loadCredentials } from '../helpers';

// Mock dependencies
jest.mock('https');
jest.mock('../helpers');
jest.mock('express', () => {
  const mockApp = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  };
  return jest.fn(() => mockApp);
});

describe('ServerManager tests', () => {
  // Define test routes
  const testRoutes = [
    {
      method: 'get',
      path: '/test1',
      handler: jest.fn()
    },
    {
      method: 'post',
      path: '/test2',
      handler: jest.fn()
    }
  ];

  // Mock server instance
  const mockServer = {
    listen: jest.fn((port, callback) => {
      callback();
      return mockServer;
    }),
    close: jest.fn((callback) => {
      if (callback) callback();
      return mockServer;
    }),
    on: jest.fn().mockReturnThis()
  };

  beforeEach(() => {
    jest.resetAllMocks();
    
    // Mock https.createServer to return mock server
    (https.createServer as jest.Mock).mockReturnValue(mockServer);
    
    // Mock console.log to prevent test output pollution
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create a server manager with routes', () => {
    const serverManager = new ServerManager(testRoutes);
    
    // Verify routes were set up
    expect(serverManager.app.get).toHaveBeenCalledWith('/test1', testRoutes[0].handler);
    expect(serverManager.app.post).toHaveBeenCalledWith('/test2', testRoutes[1].handler);
  });

  it('should create and start a server', () => {
    const serverManager = new ServerManager(testRoutes);
    const testCredentials = { key: 'test-key', cert: 'test-cert' };
    
    serverManager.createServer(testCredentials).start();
    
    // Verify https.createServer was called with credentials
    expect(https.createServer).toHaveBeenCalledWith(testCredentials, serverManager.app);
    
    // Verify server.listen was called
    expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  it('should close the server when close is called', () => {
    const serverManager = new ServerManager(testRoutes);
    const testCredentials = { key: 'test-key', cert: 'test-cert' };
    
    serverManager.createServer(testCredentials);
    const callback = jest.fn();
    serverManager.close(callback);
    
    // Verify server.close was called with callback
    expect(mockServer.close).toHaveBeenCalledWith(callback);
  });

  it('should restart the server with new credentials', () => {
    const serverManager = new ServerManager(testRoutes);
    const initialCredentials = { key: 'initial-key', cert: 'initial-cert' };
    const newCredentials = { key: 'new-key', cert: 'new-cert' };
    
    // Mock loadCredentials to return new credentials
    (loadCredentials as jest.Mock).mockReturnValue(newCredentials);
    
    // Create server with initial credentials
    serverManager.createServer(initialCredentials);
    
    // Restart server
    serverManager.restart();
    
    // Verify loadCredentials was called
    expect(loadCredentials).toHaveBeenCalled();
    
    // Verify https.createServer was called with new credentials
    expect(https.createServer).toHaveBeenCalledWith(newCredentials, serverManager.app);
    
    // Verify server.listen was called
    expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  it('should handle missing credentials during restart', () => {
    const serverManager = new ServerManager(testRoutes);
    
    // Mock loadCredentials to return null (no credentials available)
    (loadCredentials as jest.Mock).mockReturnValue(null);
    
    // Restart server
    const result = serverManager.restart();
    
    // Verify https.createServer was not called
    expect(https.createServer).not.toHaveBeenCalled();
    
    // Verify server.listen was not called
    expect(mockServer.listen).not.toHaveBeenCalled();
    
    // Verify chainable API still works
    expect(result).toBe(serverManager);
  });
});

// ping-service.test.ts
import * as https from 'https';
import { URL } from 'url';
import { ServerManager } from '../server';
import { loadCredentials, SVIDMonitor } from '../helpers';
import { EventEmitter } from 'events';
import express from 'express';

// Mock modules
jest.mock('https');
jest.mock('../server');
jest.mock('../helpers');
jest.mock('url');

describe('ping-service.js tests', () => {
  // Store original environment variables
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.resetAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
    // Mock console methods to prevent test output pollution
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterAll(() => {
    // Restore original environment variables
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // Helper to get the ping route handler from initialize function
  function getPingRouteHandler() {
    // We need to get the routes that would be passed to ServerManager
    // This requires us to mock the require function to capture routes
    // when ping-service.js is loaded
    let capturedRoutes: any[] = [];
    
    // Mock ServerManager to capture routes
    (ServerManager as jest.Mock).mockImplementation((routes) => {
      capturedRoutes = routes;
      return {
        createServer: jest.fn().mockReturnThis(),
        start: jest.fn().mockReturnThis(),
        restart: jest.fn()
      };
    });
    
    // Mock loadCredentials to return test credentials
    (loadCredentials as jest.Mock).mockReturnValue({
      cert: 'test-cert',
      key: 'test-key',
      ca: 'test-ca'
    });
    
    // Mock SVIDMonitor
    (SVIDMonitor as jest.Mock).mockImplementation(() => ({
      init: jest.fn().mockReturnThis()
    }));
    
    // Now require and initialize ping-service
    const pingService = require('../ping-service');
    
    // Find ping route handler
    const pingRoute = capturedRoutes.find(route => route.path === '/ping');
    return pingRoute ? pingRoute.handler : null;
  }

  describe('ping route handler', () => {
    it('should handle ping requests and forward to pong service', () => {
      // Get the ping route handler
      const pingHandler = getPingRouteHandler();
      expect(pingHandler).toBeDefined();
      
      // Mock loadCredentials for the handler call
      (loadCredentials as jest.Mock).mockReturnValue({
        cert: 'test-cert',
        key: 'test-key',
        ca: 'test-ca'
      });
      
      // Mock URL constructor
      (URL as jest.Mock).mockImplementation(() => ({
        hostname: 'pong-service',
        port: '3001',
        pathname: '/pong'
      }));
      
      // Setup mock response and request for pong service call
      const mockResponse = new EventEmitter();
      mockResponse.on = jest.fn().mockImplementation((event, callback) => {
        if (event === 'end') {
          setTimeout(() => callback(), 0); // Call end callback asynchronously
        }
        return mockResponse;
      });
      
      const mockRequest = new EventEmitter();
      mockRequest.end = jest.fn();
      
      // Mock https.request
      (https.request as jest.Mock).mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });
      
      // Create mock Express req/res objects
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };
      
      // Call the ping handler
      pingHandler(req, res);
      
      // Verify https.request was called with correct options
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'pong-service',
          port: '3001',
          path: '/pong',
          method: 'GET',
          cert: 'test-cert',
          key: 'test-key',
          ca: 'test-ca',
          rejectUnauthorized: true
        }),
        expect.any(Function)
      );
      
      // Simulate response data
      mockResponse.emit('data', 'pong');
      mockResponse.emit('end');
      
      // Use setImmediate to wait for async operations to complete
      return new Promise<void>(resolve => {
        setImmediate(() => {
          // Verify res.send was called with correct response
          expect(res.send).toHaveBeenCalledWith('Ping sent, received: pong');
          resolve();
        });
      });
    });

    it('should handle errors when credentials are not available', () => {
      // Get the ping route handler
      const pingHandler = getPingRouteHandler();
      expect(pingHandler).toBeDefined();
      
      // Mock loadCredentials to return null
      (loadCredentials as jest.Mock).mockReturnValue(null);
      
      // Create mock Express req/res objects
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };
      
      // Call the ping handler
      pingHandler(req, res);
      
      // Verify error response
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Server credentials not available');
    });

    it('should handle pong service communication errors', () => {
      // Get the ping route handler
      const pingHandler = getPingRouteHandler();
      expect(pingHandler).toBeDefined();
      
      // Mock loadCredentials
      (loadCredentials as jest.Mock).mockReturnValue({
        cert: 'test-cert',
        key: 'test-key',
        ca: 'test-ca'
      });
      
      // Mock URL constructor
      (URL as jest.Mock).mockImplementation(() => ({
        hostname: 'pong-service',
        port: '3001',
        pathname: '/pong'
      }));
      
      // Setup mock request with error
      const mockRequest = new EventEmitter();
      mockRequest.end = jest.fn();
      
      // Mock https.request
      (https.request as jest.Mock).mockReturnValue(mockRequest);
      
      // Create mock Express req/res objects
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };
      
      // Call the ping handler
      pingHandler(req, res);
      
      // Simulate request error
      mockRequest.emit('error', new Error('Connection refused'));
      
      // Verify error response
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Error communicating with pong service');
    });
  });

  describe('health route', () => {
    it('should respond with health status', () => {
      // Extract routes passed to ServerManager
      let capturedRoutes: any[] = [];
      
      // Mock ServerManager to capture routes
      (ServerManager as jest.Mock).mockImplementation((routes) => {
        capturedRoutes = routes;
        return {
          createServer: jest.fn().mockReturnThis(),
          start: jest.fn().mockReturnThis(),
          restart: jest.fn()
        };
      });
      
      // Mock loadCredentials
      (loadCredentials as jest.Mock).mockReturnValue({
        cert: 'test-cert',
        key: 'test-key',
        ca: 'test-ca'
      });
      
      // Mock SVIDMonitor
      (SVIDMonitor as jest.Mock).mockImplementation(() => ({
        init: jest.fn().mockReturnThis()
      }));
      
      // Initialize ping-service
      require('../ping-service');
      
      // Find health route handler
      const healthRoute = capturedRoutes.find(route => route.path === '/health');
      expect(healthRoute).toBeDefined();
      
      // Create mock Express req/res objects
      const req = {};
      const res = {
        send: jest.fn()
      };
      
      // Call the health handler
      healthRoute.handler(req, res);
      
      // Verify response
      expect(res.send).toHaveBeenCalledWith('Ping service is healthy');
    });
  });

  describe('initialize function', () => {
    it('should create server and set up SVID monitoring', () => {
      // Mock ServerManager
      const mockServerManager = {
        createServer: jest.fn().mockReturnThis(),
        start: jest.fn().mockReturnThis(),
        restart: jest.fn()
      };
      (ServerManager as jest.Mock).mockReturnValue(mockServerManager);
      
      // Mock loadCredentials
      (loadCredentials as jest.Mock).mockReturnValue({
        cert: 'test-cert',
        key: 'test-key',
        ca: 'test-ca'
      });
      
      // Mock SVIDMonitor
      const mockSVIDMonitor = {
        init: jest.fn().mockReturnThis()
      };
      (SVIDMonitor as jest.Mock).mockImplementation((callback) => {
        // Store callback for testing
        (mockSVIDMonitor as any).callback = callback;
        return mockSVIDMonitor;
      });
      
      // Initialize ping-service
      require('../ping-service');
      
      // Verify ServerManager was created with routes
      expect(ServerManager).toHaveBeenCalledWith(expect.any(Array));
      
      // Verify server was created with credentials
      expect(mockServerManager.createServer).toHaveBeenCalledWith({
        cert: 'test-cert',
        key: 'test-key',
        ca: 'test-ca'
      });
      
      // Verify server was started
      expect(mockServerManager.start).toHaveBeenCalled();
      
      // Verify SVIDMonitor was created with restart callback
      expect(SVIDMonitor).toHaveBeenCalledWith(expect.any(Function));
      expect(mockSVIDMonitor.init).toHaveBeenCalled();
      
      // Test SVIDMonitor callback
      (mockSVIDMonitor as any).callback();
      expect(mockServerManager.restart).toHaveBeenCalled();
    });

    it('should not start server if initial credentials are missing', () => {
      // Mock ServerManager
      const mockServerManager = {
        createServer: jest.fn().mockReturnThis(),
        start: jest.fn().mockReturnThis(),
        restart: jest.fn()
      };
      (ServerManager as jest.Mock).mockReturnValue(mockServerManager);
      
      // Mock loadCredentials to return null (no credentials)
      (loadCredentials as jest.Mock).mockReturnValue(null);
      
      // Mock SVIDMonitor
      (SVIDMonitor as jest.Mock).mockImplementation(() => ({
        init: jest.fn().mockReturnThis()
      }));
      
      // Initialize ping-service
      require('../ping-service');
      
      // Verify ServerManager was created with routes
      expect(ServerManager).toHaveBeenCalledWith(expect.any(Array));
      
      // Verify server was NOT created with credentials or started
      expect(mockServerManager.createServer).not.toHaveBeenCalled();
      expect(mockServerManager.start).not.toHaveBeenCalled();
      
      // Verify SVIDMonitor was still created and initialized
      expect(SVIDMonitor).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
