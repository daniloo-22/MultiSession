import { defineConfig } from 'vite'

// The MCP bridge runs under plain Node (launched by the assistant), so it is bundled
// into a single self-contained file with all its dependencies.
export default defineConfig({
  build: {
    ssr: 'src/mcp/bridge.ts',
    outDir: 'out/mcp',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'bridge.mjs' }
    }
  },
  ssr: { noExternal: true, target: 'node' }
})
