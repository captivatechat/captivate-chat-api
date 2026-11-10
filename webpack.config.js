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
            library: {
                type: 'commonjs2'
            }
        }
    }
];
