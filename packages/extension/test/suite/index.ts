import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 45_000, color: false });
  mocha.suite.emit('pre-require', globalThis, 'smoke', mocha);
  // Bundled by esbuild. It has to load after the line above defines `describe` and `it`.
  require('./smoke.ts');
  return new Promise((resolve, reject) => {
    mocha.run(failures => (failures > 0 ? reject(new Error(`${failures} tests failed`)) : resolve()));
  });
}
