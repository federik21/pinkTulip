import { defineConfig } from '@playwright/test';

export default defineConfig({
 testDir:'./e2e', timeout:90000, workers:1,
 use:{baseURL:'http://127.0.0.1:15173',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:[
  {command:'node --import tsx apps/server/src/index.ts',env:{PORT:'18080'},port:18080,reuseExistingServer:false},
  {command:'npm run dev -w @brw/client -- --host 127.0.0.1 --port 15173 --strictPort',env:{VITE_WS_URL:'ws://127.0.0.1:18080'},url:'http://127.0.0.1:15173',reuseExistingServer:false},
 ],
});