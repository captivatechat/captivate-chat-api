const path = require('path');

const shared = {
    entry: './src/index.ts',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js']
    }
};

module.exports = [
    // Browsers, React Native and bundlers for them (package.json's "browser"), and script tags.
    // Built for the web, so `ws` resolves to its browser stub: these runtimes have a WebSocket.
    {
        ...shared,
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'captivate-chat-api.js',
            library: {
                type: 'umd'
            },
            globalObject: 'this'
        }
    },
    // Node (package.json's "main"). `ws` stays a require of the installed package: Node 20 has no
    // WebSocket of its own, and the web build's copy of `ws` is the stub that throws
    // "ws does not work in the browser".
    {
        ...shared,
        target: 'node',
        externals: {
            ws: 'commonjs ws'
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'captivate-chat-api.node.js',
            // `exports.X = …` lines Node's ESM loader can read, so `import { CaptivateChatAPI } from
            // 'captivate-chat-api'` works in a .mjs file or a "type": "module" app; commonjs2's
            // `module.exports = …` gives ESM a default export only.
            library: {
                type: 'commonjs-static'
            }
        }
    }
];
