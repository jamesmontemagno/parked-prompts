import { canvasKit } from '@rwoll/canvas-kit/vite'
import { defineConfig } from 'vite'

// One plugin, named for the product rather than this workspace package.
export default defineConfig({
  plugins: [canvasKit({ name: 'parked-prompts' })],
})
