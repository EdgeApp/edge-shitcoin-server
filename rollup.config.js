import babel from 'rollup-plugin-babel'
const packageJson = require('./package.json')

export default {
  entry: 'src/server.js',
  external: Object.keys(packageJson.dependencies),
  plugins: [babel({})],
  targets: [
    {
      dest: packageJson['main'],
      format: 'cjs',
      sourceMap: true
    }
  ]
}
