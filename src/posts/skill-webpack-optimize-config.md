---
layout: post
title: 旧项目升级 Webpack 与优化
excerpt: 记录一次将迭代超过4年的旧项目升级到 Webpack 4 并优化的过程
date: 2019-09-17
tags:
  - post
  - skill
---

### Before | 原始配置`atool-build`

> 升级前：该项目编译时间为 5 - 7 分钟，编译后代码体积庞大(40+Mb)。

```javascript
const webpack = require('atool-build/lib/webpack');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');

module.exports = function (webpackConfig, env) {
  webpackConfig.babel.plugins.push('transform-runtime');
  webpackConfig.babel.plugins.push([
    'import',
    [
      { libraryName: 'antd', style: true },
      { libraryName: 'sharing-business-modules', style: true },
    ],
  ]);

  // Support hmr
  if (env === 'development') {
    webpackConfig.devtool = '#eval';
    webpackConfig.babel.plugins.push([
      'dva-hmr',
      {
        entries: ['./src/index.js'],
      },
    ]);
  } else {
    webpackConfig.babel.plugins.push('dev-expression');
  }
  var version = 'dev';
  for (var i in process.argv) {
    if (process.argv[i].indexOf('env=release') > -1) {
      version = 'release';
      break;
    } else if (process.argv[i].indexOf('env=demo') > -1) {
      version = 'demo';
    }
  }

  var copyWebpackPlugin = new CopyWebpackPlugin([
    {
      from: __dirname + '/src/utils/ueditor/',
      to: __dirname + '/dist/src/utils/ueditor/',
    },
    { from: __dirname + '/lib/', to: __dirname + '/dist/lib' },
    {
      from: __dirname + '/src/images/favicon.ico',
      to: __dirname + '/dist/favicon.ico',
    },
  ]);
  webpackConfig.plugins.push(copyWebpackPlugin);
  webpackConfig.plugins.push(new CleanWebpackPlugin());
  //生产环境
  if (version == 'release') {
    //正式机
    webpackConfig.plugins.push(
      new webpack.DefinePlugin({
        __BASEURL__: JSON.stringify('https://production.com/'),
      })
    );
  } else if (version == 'demo') {
    webpackConfig.plugins.push(
      new webpack.DefinePlugin({
        __BASEURL__: JSON.stringify('https://stage.com/'),
      })
    );
  } else {
    // 测试机
    webpackConfig.plugins.push(
      new webpack.DefinePlugin({
        __BASEURL__: JSON.stringify('https://test.com/'),
      })
    );
  }

  webpackConfig.output = {
    path: path.join(__dirname, './dist'),
    filename: '[name].js',
    publicPath: '/',
  };

  webpackConfig.resolve = {
    alias: {
      src: path.resolve(__dirname, './src'),
      components: path.resolve(__dirname, './src/components'),
      images: path.resolve(__dirname, './src/images'),
      services: path.resolve(__dirname, './src/services'),
      utils: path.resolve(__dirname, './src/utils'),
    },
  };

  // Don't extract common.js and common.css
  webpackConfig.plugins = webpackConfig.plugins.filter(function (plugin) {
    return !(plugin instanceof webpack.optimize.CommonsChunkPlugin);
  });

  // Support CSS Modules
  // Parse all less files as css module.
  webpackConfig.module.loaders.forEach(function (loader, index) {
    if (
      typeof loader.test === 'function' &&
      loader.test.toString().indexOf('\\.less$') > -1
    ) {
      loader.include = /node_modules/;
      loader.test = /\.less$/;
    }
    if (loader.test.toString() === '/\\.module\\.less$/') {
      loader.exclude = /node_modules/;
      loader.test = /\.less$/;
    }
    if (
      typeof loader.test === 'function' &&
      loader.test.toString().indexOf('\\.css$') > -1
    ) {
      loader.include = /node_modules/;
      loader.test = /\.css$/;
    }
    if (loader.test.toString() === '/\\.module\\.css$/') {
      loader.exclude = /node_modules/;
      loader.test = /\.css$/;
    }
    if (loader.test.toString() === '/.(png|jpg|gif)$/') {
      loader.exclude = /node_modules/;
      loader.loaders = 'url-loader?limit=5024';
    }
  });

  return webpackConfig;
};
```

### After | 优化后的配置

> 升级后：初次编译时间维持在 40 秒左右，缓存后编译时间仅需 20 秒，编译后代码体积减少了 70%(10+Mb)。

```javascript
const path = require('path');
const chalk = require('chalk'); // log
const webpack = require('webpack');
const merge = require('webpack-merge');
// const CopyWebpackPlugin = require("copy-webpack-plugin")
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const OptimizeCssAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const TerserJSPlugin = require('terser-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const ProgressBarPlugin = require('progress-bar-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const os = require('os');
const address = require('address');
const config = require('./src/config/common');

// 环境类型
const ENV_TYPE = {
  STAGE: 'stage', // 开发环境
  RELEASE: 'release', // 生产环境
  TEST: 'test', // 测试环境
};

// 编译模式类型
const MODE_TYPE = {
  DEV: 'dev', // 开发模式
  BUILD: 'build', // 打包模式
};

// 获取服务器配置
const getServerConfig = (env = ENV_TYPE.STAGE) => {
  const SERVER_MAP = {
    [ENV_TYPE.RELEASE]: {
      __BASEURL__: JSON.stringify('https://production.com/'),
    },
    [ENV_TYPE.STAGE]: {
      __BASEURL__: JSON.stringify('https://stage.com/'),
    },
    [ENV_TYPE.TEST]: {
      __BASEURL__: JSON.stringify('https://test.com/'),
    },
  };
  const COMMON_SERVER = {};
  const server = SERVER_MAP[env] || {};
  const combineServer = Object.assign(server, COMMON_SERVER);
  return combineServer;
};

// 全局配置
const CONFIG = {
  buildCDN: config.URL_BASE_NAME, // 编译模式CDN
  devCDN: '/', // 开发模式CDN
  assetsPath: 'static/', // 静态资源目录
  output: path.resolve(__dirname, './dist'), // 输出目录
  host: '0.0.0.0', // devServer host
  port: 11000, // devServer port
  template: path.resolve(__dirname, 'public/index.html'), // template文件
  sizeUnit: 1024, // 单位
};

// 基础配置
const baseConfig = (env, mode = MODE_TYPE.DEV) => ({
  entry: './src/index.jsx',
  output: {
    path: CONFIG.output,
    publicPath: mode === MODE_TYPE.DEV ? CONFIG.devCDN : CONFIG.buildCDN,
  },
  stats: {
    // copied from `'minimal'`
    all: false,
    modules: true,
    maxModules: 0,
    errors: true,
    warnings: true,
    // our additional options
    moduleTrace: true,
    errorDetails: true,
    warningsFilter: /(?!antd)/,
    builtAt: true,
    timings: true,
  },
  module: {
    rules: [
      {
        oneOf: [
          {
            test: /\.(js|jsx|ts|tsx)$/,
            exclude: [
              /node_modules/,
              // __dirname + '/src/utils/ueditor/',
              // __dirname + '/lib/',
            ],
            use: [
              {
                loader: 'thread-loader',
                options: {
                  workers: os.cpus().length,
                },
              },
              {
                loader: 'babel-loader',
                options: {
                  cacheDirectory: true,
                },
              },
            ],
          },
          //TODO 这里开启自己编写的less&css文件的css modules功能 除了node_modules库中的less&css
          {
            test: /\.(css|less)$/,
            exclude: /node_modules|antd/,
            use: [
              mode === MODE_TYPE.DEV
                ? ('css-hot-loader', 'style-loader')
                : MiniCssExtractPlugin.loader,
              // {
              //   loader: MiniCssExtractPlugin.loader,
              //   options: {
              //     // only enable hot in development
              //     hmr: mode === MODE_TYPE.DEV,
              //     // if hmr does not work, this is a forceful method.
              //     reloadAll: true,
              //   },
              // },
              // 'style-loader',
              {
                loader: 'css-loader',
                options: {
                  // TODO  配置对css modules的支持
                  // 如果不想开启CSS的module功能 注释下面一段代码即可
                  // modules: true,
                  // localIdentName: '[local]--[hash:base64:5]'
                },
              },
              {
                loader: 'less-loader',
                options: {
                  javascriptEnabled: true,
                },
              }, // compiles Less to CSS
            ],
          },
          //TODO 针对node_modules和antd里面的less&css写编译配置
          {
            test: /\.(css|less)$/,
            include: /node_modules|antd|antd-mobile/,
            use: [
              mode === MODE_TYPE.DEV
                ? ('css-hot-loader', 'style-loader')
                : MiniCssExtractPlugin.loader,
              'css-loader',
              {
                loader: 'less-loader',
                options: {
                  modifyVars: {
                    hack: `true; @import "~@styles/theme.less";`, // Override with less file
                  },
                  javascriptEnabled: true,
                },
              },
            ],
          },
          {
            // "url" loader works like "file" loader except that it embeds assets
            // smaller than specified limit in bytes as data URLs to avoid requests.
            test: /\.(jpg|jpeg|bmp|svg|png|webp|gif)$/,
            loader: 'url-loader',
            options: {
              limit: 8 * CONFIG.sizeUnit,
              name: `${mode === MODE_TYPE.DEV ? '' : '/'}${
                CONFIG.assetsPath
              }images/[name].[hash:8].[ext]`,
            },
          },
          {
            // "file" loader makes sure those assets get served by WebpackDevServer.
            // When you `import` an asset, you get its (virtual) filename.
            // In production, they would get copied to the `build` folder.
            // This loader doesn't use a "test" so it will catch all modules
            // that fall through the other loaders.
            // Exclude `js` files to keep "css" loader working as it injects
            // its runtime that would otherwise processed through "file" loader.
            // Also exclude `html` and `json` extensions so they get processed
            // by webpacks internal loaders.
            exclude: [/\.(js|jsx|ts|tsx|mjs)$/, /\.html$/, /\.json$/],
            loader: 'file-loader',
            options: {
              limit: 10 * CONFIG.sizeUnit,
              name: `${CONFIG.assetsPath}media/[name].[hash:8].[ext]`,
            },
          },
        ],
      },
    ],
  },
  resolve: {
    // Attempt to resolve these extensions in order
    extensions: ['.js', '.jsx', 'ts', 'tsx', '.json'],
    // 此处为了兼容旧配置 @xxx 等路径，一般来说 只需要配置 @ 作为相对路径即可
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@components': path.resolve(__dirname, './src/components'),
      '@config': path.resolve(__dirname, './src/config'),
      '@constant': path.resolve(__dirname, './src/constant'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@reducers': path.resolve(__dirname, './src/reducers'),
      '@routes': path.resolve(__dirname, './src/routes'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@utils': path.resolve(__dirname, './src/utils'),
    },
  },
  plugins: [
    // 注意这里不能写[hash]，否则无法实现热跟新，如果有hash需要，可以开发环境和生产环境分开配置
    // https://github.com/jantimon/html-webpack-plugin#minification
    new MiniCssExtractPlugin({
      filename:
        mode === MODE_TYPE.DEV
          ? '[name].css'
          : `${CONFIG.assetsPath}css/[name].[contenthash].css`,
      chunkFilename:
        mode === MODE_TYPE.DEV
          ? '[name].css'
          : `${CONFIG.assetsPath}css/[name].[contenthash].css`,
      ignoreOrder: true,
    }),
    new HtmlWebpackPlugin({
      template: CONFIG.template,
      // favicon: './src/assets/favicon.ico',
      chunksSortMode: 'none',
    }),
    // new CopyWebpackPlugin([
    //   { from: __dirname + '/src/utils/ueditor/', to: __dirname + '/dist/src/utils/ueditor/' },
    //   { from: __dirname + '/lib/', to: __dirname + '/dist/lib' },
    // ]),
    // Moment.js is an extremely popular library that bundles large locale files
    // by default due to how Webpack interprets its code. This is a practical
    // solution that requires the user to opt into importing specific locales.
    // https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
    // You can remove this if you don't use Moment.js:
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
    new webpack.DefinePlugin(getServerConfig(env)),
    new ProgressBarPlugin({
      format: `build [:bar] ${chalk.green.bold(':percent')} (:elapsed seconds)`,
    }),
  ],
});

// 开发模式配置
const devConfig = {
  mode: 'development',
  // You may want 'eval' instead if you prefer to see the compiled output in DevTools.
  // See the discussion in https://github.com/facebookincubator/create-react-app/issues/343
  // docs https://webpack.js.org/configuration/devtool/#root
  devtool: 'cheap-eval-source-map',
  devServer: {
    // 注意，必须有 webpack.HotModuleReplacementPlugin 才能完全启用 HMR
    hot: true,
    // 当出现编译器错误或警告时，在浏览器中显示全屏覆盖层
    overlay: true,
    host: CONFIG.host,
    stats: 'errors-only',
    disableHostCheck: true,
    historyApiFallback: true,
    port: CONFIG.port || 8000,
    contentBase: CONFIG.output,
    transportMode: 'ws',
  },
  output: {
    // This does not produce a real file. It's just the virtual path that is
    // served by WebpackDevServer in development. This is the JS bundle
    // containing code from all our entry points, and the Webpack runtime.
    filename: `${CONFIG.assetsPath}js/bundle.js`,
    // There are also additional JS chunk files if you use code splitting.
    chunkFilename: `${CONFIG.assetsPath}js/[name].chunk.js`,
  },
  plugins: [
    // This is necessary to emit hot updates (currently CSS only):
    new webpack.HotModuleReplacementPlugin(),
    // Add module names to factory functions so they appear in browser profiler.
    new webpack.NamedModulesPlugin(),
  ],
};

// 打包模式配置
const buildConfig = {
  mode: 'production',
  output: {
    // This does not produce a real file. It's just the virtual path that is
    // served by WebpackDevServer in development. This is the JS bundle
    // containing code from all our entry points, and the Webpack runtime.
    filename: `${CONFIG.assetsPath}js/[name].[contenthash:8].js`,
    // There are also additional JS chunk files if you use code splitting.
    chunkFilename: `${CONFIG.assetsPath}js/[name].[contenthash:8].chunk.js`,
  },
  optimization: {
    // Keep the runtime chunk separated to enable long term caching
    // https://twitter.com/wSokra/status/969679223278505985
    runtimeChunk: true,
    // 设置moduleId为hash值
    moduleIds: 'hashed',
    minimizer: [
      new TerserJSPlugin({
        cache: true,
        parallel: true,
      }),
      new OptimizeCssAssetsPlugin({
        cssProcessor: require('cssnano'),
        cssProcessorOptions: {
          discardComments: { removeAll: true },
          parser: require('postcss-safe-parser'),
          autoprefixer: false,
        },
        canPrint: true,
      }),
    ],
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        styles: {
          name: 'vendors-styles',
          test: /\.css$/,
          enforce: true,
          priority: 100,
        },
        antd: {
          name: 'vendors-antd',
          test: /[\\/]node_modules[\\/]antd[\\/]/,
          priority: 10,
        },
        react: {
          name: 'vendors-react',
          test: /[\\/]node_modules[\\/]react[\\/]/,
          priority: 10,
        },
        commons: {
          // 这部分模块不经常改变
          // 经常改变的是main.js 虽然分为一个包多了一个请求 但main文件减小到仅为 4kb
          name: 'vendors-commons',
          test: /[\\/]node_modules[\\/]/,
          chunks: 'initial', // 只打包初始时依赖的第三方
          enforce: true,
        },
      },
    },
  },
  plugins: [new CleanWebpackPlugin()],
};

module.exports = (
  env = { NODE_ENV: ENV_TYPE.STAGE, MODE: MODE_TYPE.DEV, REPORT: false }
) => {
  const protocol = 'http://';
  const localAddress = `${protocol}localhost:${CONFIG.port}`;
  const networkAddress = `${protocol}${address.ip()}:${CONFIG.port}`;
  const baseWebpackConfig = baseConfig(env.NODE_ENV, env.MODE);
  env.REPORT && baseWebpackConfig.plugins.push(new BundleAnalyzerPlugin());

  // 环境变量
  const CONFIG_MAP = {
    [MODE_TYPE.BUILD]: merge(baseWebpackConfig, buildConfig),
    [MODE_TYPE.DEV]: merge(baseWebpackConfig, devConfig),
  };
  console.log(`打包环境: ${chalk.red(env.NODE_ENV)}`);
  console.log(`编译模式: ${chalk.red(env.MODE)}`);
  console.log(`开启代码分析: ${chalk.red(!!env.REPORT)}`);
  if (env.MODE === MODE_TYPE.DEV) {
    console.log();
    console.log(`  App running at:`);
    console.log(`  - Local:   ${chalk.cyan(localAddress)}`);
    console.log(`  - Network: ${chalk.cyan(networkAddress)}`);
    console.log();
  }

  return CONFIG_MAP[env.MODE] || CONFIG_MAP[MODE_TYPE.DEV];
};
```
