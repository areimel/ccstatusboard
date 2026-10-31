// Run with bun: bun scripts/bun-compile.mjs <os-arch> <version> <outfile>
// Compiles src/cli.tsx into a standalone executable. react-devtools-core (an
// optional peer of ink, only used when DEV=true) is stubbed out because Bun
// hoists even guarded imports and would crash at startup if it was left external.
const [target, version, outfile] = process.argv.slice(2);

const stubDevtools = {
  name: 'stub-react-devtools-core',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default { initialize() {}, connectToDevTools() {} };',
      loader: 'js',
    }));
  },
};

const result = await Bun.build({
  entrypoints: ['src/cli.tsx'],
  minify: true,
  define: { __CCSB_VERSION__: JSON.stringify(version) },
  plugins: [stubDevtools],
  compile: { target: `bun-${target}`, outfile },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
