import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({base:'/assets/quest_automations/ui/',build:{outDir:'../quest_automations/public/ui',manifest:'manifest.json'},plugins:[react(),tailwindcss()],server:{proxy:{'/api':'http://127.0.0.1:8766','/hooks':'http://127.0.0.1:8766'}}});
