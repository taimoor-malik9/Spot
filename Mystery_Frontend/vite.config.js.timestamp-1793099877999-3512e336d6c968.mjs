// vite.config.js
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "file:///E:/FYP/z/SPOT_Updated/SPOT/Mystery_Frontend/node_modules/vite/dist/node/index.js";
import react from "file:///E:/FYP/z/SPOT_Updated/SPOT/Mystery_Frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///E:/FYP/z/SPOT_Updated/SPOT/Mystery_Frontend/node_modules/@tailwindcss/vite/dist/index.mjs";
var __vite_injected_original_import_meta_url = "file:///E:/FYP/z/SPOT_Updated/SPOT/Mystery_Frontend/vite.config.js";
var __dirname = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var projectRoot = path.resolve(__dirname);
function logProjectRoot() {
  return {
    name: "log-project-root",
    configureServer() {
      console.log(`
[Vite] Project root: ${projectRoot}
`);
    },
    buildStart() {
      console.log(`
[Vite build] Project root: ${projectRoot}
`);
    }
  };
}
var vite_config_default = defineConfig({
  plugins: [logProjectRoot(), tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:5000",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxGWVBcXFxcelxcXFxTUE9UX1VwZGF0ZWRcXFxcU1BPVFxcXFxNeXN0ZXJ5X0Zyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJFOlxcXFxGWVBcXFxcelxcXFxTUE9UX1VwZGF0ZWRcXFxcU1BPVFxcXFxNeXN0ZXJ5X0Zyb250ZW5kXFxcXHZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9FOi9GWVAvei9TUE9UX1VwZGF0ZWQvU1BPVC9NeXN0ZXJ5X0Zyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHBhdGggZnJvbSAncGF0aCdcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnXG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ0B0YWlsd2luZGNzcy92aXRlJ1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKVxuY29uc3QgcHJvamVjdFJvb3QgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lKVxuXG5mdW5jdGlvbiBsb2dQcm9qZWN0Um9vdCgpIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiAnbG9nLXByb2plY3Qtcm9vdCcsXG4gICAgY29uZmlndXJlU2VydmVyKCkge1xuICAgICAgY29uc29sZS5sb2coYFxcbltWaXRlXSBQcm9qZWN0IHJvb3Q6ICR7cHJvamVjdFJvb3R9XFxuYClcbiAgICB9LFxuICAgIGJ1aWxkU3RhcnQoKSB7XG4gICAgICBjb25zb2xlLmxvZyhgXFxuW1ZpdGUgYnVpbGRdIFByb2plY3Qgcm9vdDogJHtwcm9qZWN0Um9vdH1cXG5gKVxuICAgIH0sXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW2xvZ1Byb2plY3RSb290KCksIHRhaWx3aW5kY3NzKCksIHJlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJyksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiB7XG4gICAgICAgIHRhcmdldDogcHJvY2Vzcy5lbnYuVklURV9CQUNLRU5EX1VSTCB8fCAnaHR0cDovL2xvY2FsaG9zdDo1MDAwJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICBzZWN1cmU6IGZhbHNlLFxuICAgICAgfVxuICAgIH1cbiAgfSxcbn0pIl0sCiAgIm1hcHBpbmdzIjogIjtBQUErVCxPQUFPLFVBQVU7QUFDaFYsU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBQ2xCLE9BQU8saUJBQWlCO0FBSmlMLElBQU0sMkNBQTJDO0FBTTFQLElBQU0sWUFBWSxLQUFLLFFBQVEsY0FBYyx3Q0FBZSxDQUFDO0FBQzdELElBQU0sY0FBYyxLQUFLLFFBQVEsU0FBUztBQUUxQyxTQUFTLGlCQUFpQjtBQUN4QixTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixrQkFBa0I7QUFDaEIsY0FBUSxJQUFJO0FBQUEsdUJBQTBCLFdBQVc7QUFBQSxDQUFJO0FBQUEsSUFDdkQ7QUFBQSxJQUNBLGFBQWE7QUFDWCxjQUFRLElBQUk7QUFBQSw2QkFBZ0MsV0FBVztBQUFBLENBQUk7QUFBQSxJQUM3RDtBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxlQUFlLEdBQUcsWUFBWSxHQUFHLE1BQU0sQ0FBQztBQUFBLEVBQ2xELFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLFdBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLFFBQ04sUUFBUSxRQUFRLElBQUksb0JBQW9CO0FBQUEsUUFDeEMsY0FBYztBQUFBLFFBQ2QsUUFBUTtBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
