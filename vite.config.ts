import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Requis pour GitHub Pages : https://ytfeez.github.io/artillerie-map/
  base: '/artillerie-map/',
})
