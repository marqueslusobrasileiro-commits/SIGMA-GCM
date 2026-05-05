module.exports = {
  plugins: {
    'postcss-preset-env': {
      stage: 3,
      features: {
        'oklab-function': true,
        'color-function': true,
        'color-mix': true,
        'relative-color-syntax': true
      }
    },
    'autoprefixer': {}
  }
}
