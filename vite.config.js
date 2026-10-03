import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': 'http://localhost:4173', '/uploads': 'http://localhost:4173', '/live': { target:'ws://localhost:4173', ws:true } } } });
