const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Two builds from one source. `main.ts` is the local/e2e entry; `serverless.ts`
// is the M4 Lambda entry (same Nest app, wrapped for API Gateway). The Lambda
// build is selected by an explicit env flag so CI packages exactly the artifact
// it deploys.
const LAMBDA_BUILD = process.env.LAMBDA_BUILD === '1';

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    filename: LAMBDA_BUILD ? 'serverless.js' : undefined,
    clean: true,
    // The Lambda runtime needs `module.exports = { handler }` at the bundle
    // root. Webpack's default node output leaves the entry's exports inside
    // its module closure; commonjs2 lifts them onto module.exports.
    ...(LAMBDA_BUILD && { library: { type: 'commonjs2' } }),
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: LAMBDA_BUILD ? './src/serverless.ts' : './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
