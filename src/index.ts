import { networks } from '@btc-vision/bitcoin';
import type { ScannerConfig } from './interfaces/IConfig.js';
import { BlockScanner } from './core/BlockScanner.js';

const config: ScannerConfig = {
    network: networks.opnetTestnet,
    rpcUrl: 'https://testnet.opnet.org',
    wsUrl: 'wss://testnet.opnet.org',
    contractAddress: 'opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle',
    reorgBufferSize: 100,
    pollIntervalMs: 10_000,
    startBlock: 14086n,
};

const scanner = new BlockScanner(config);

process.on('SIGINT', () => {
    console.log('\nShutting down...');

    void scanner.stop().then(() => process.exit(0));
});

await scanner.start();
