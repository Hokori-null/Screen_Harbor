module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "screen-harbor",
    // ssh2 is intentionally external to Vite. Include production dependencies;
    // Electron Packager prunes devDependencies before creating the archive.
    ignore: (file) =>
      !!file &&
      !file.startsWith("/.vite") &&
      !file.startsWith("/node_modules") &&
      file !== "/package.json",
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: { name: "screen_harbor" },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          { entry: "src/main.ts", config: "vite.main.config.ts" },
          { entry: "src/preload.ts", config: "vite.preload.config.ts" },
        ],
        renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
      },
    },
  ],
};
