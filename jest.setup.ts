/**
 * @file jest.setup.ts
 * @description Jest configuration and global setup
 */

import '@testing-library/jest-dom';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    })),
});

// Mock environment variables
process.env.REACT_APP_API_URL = 'http://localhost:3001';
process.env.VITE_API_URL = 'http://localhost:3001';
