import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: ["./src/index.ts", "./src/cli.ts"],
  hooks: {
    async start() {
      // The inlined runtime is checked in, but always rebuild it so a build never ships stale output.
      const { writeRuntime } = await import("./scripts/build-runtime.ts");
      await writeRuntime();
    },
  },
});
