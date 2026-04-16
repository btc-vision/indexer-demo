import {
    type BlockNotification,
    type JSONRpcProvider,
    SubscriptionType,
    WebSocketClientEvent,
    WebSocketRpcProvider,
} from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { Logger } from '@btc-vision/logger';

export class ConnectionManager extends Logger {
    public override readonly logColor: string = '#2596e7';

    #wsProvider: WebSocketRpcProvider | undefined;
    #pollTimer: ReturnType<typeof setInterval> | undefined;

    readonly #httpProvider: JSONRpcProvider;
    readonly #wsUrl: string;
    readonly #network: Network;
    readonly #pollIntervalMs: number;

    readonly #onBlock: (height: bigint) => Promise<void>;

    public constructor(
        httpProvider: JSONRpcProvider,
        wsUrl: string,
        network: Network,
        pollIntervalMs: number,
        onBlock: (height: bigint) => Promise<void>,
    ) {
        super();

        this.#httpProvider = httpProvider;
        this.#wsUrl = wsUrl;
        this.#network = network;
        this.#pollIntervalMs = pollIntervalMs;
        this.#onBlock = onBlock;
    }

    /**
     * Attempts a WebSocket connection. Falls back to polling if WS is unavailable.
     */
    public async connect(): Promise<void> {
        try {
            await this.#connectWebSocket();
            console.log('Connected via WebSocket');
        } catch (err: unknown) {
            console.warn('WebSocket unavailable, polling:', (err as Error).message);
            this.#startPolling();
        }
    }

    /**
     * Disconnects WebSocket, stops polling, and releases all resources.
     */
    public async disconnect(): Promise<void> {
        this.#stopPolling();

        if (!this.#wsProvider) {
            return;
        }

        try {
            await this.#wsProvider.unsubscribe(SubscriptionType.BLOCKS);
        } catch {
            /* already gone */
        }

        this.#wsProvider.disconnect();
        this.#wsProvider = undefined;
    }

    async #connectWebSocket(): Promise<void> {
        this.#wsProvider = new WebSocketRpcProvider({
            url: this.#wsUrl,
            network: this.#network,
            websocketConfig: {
                autoReconnect: true,
                maxReconnectAttempts: 10,
                reconnectBaseDelay: 2_000,
            },
        });

        await this.#wsProvider.connect();

        await this.#wsProvider.subscribeBlocks((notification: BlockNotification) => {
            void this.#onBlock(notification.blockNumber);
        });

        this.#wsProvider.on(WebSocketClientEvent.DISCONNECTED, () => {
            console.warn('WebSocket disconnected, activating poll fallback');
            this.#startPolling();
        });

        this.#wsProvider.on(WebSocketClientEvent.CONNECTED, () => {
            console.log('WebSocket reconnected, deactivating poll fallback');
            this.#stopPolling();
        });
    }

    #startPolling(): void {
        if (this.#pollTimer !== undefined) return;

        this.#pollTimer = setInterval(() => {
            void this.#poll();
        }, this.#pollIntervalMs);

        console.log(`Polling every ${this.#pollIntervalMs}ms`);
    }

    #stopPolling(): void {
        if (this.#pollTimer !== undefined) {
            clearInterval(this.#pollTimer);
            this.#pollTimer = undefined;
        }
    }

    async #poll(): Promise<void> {
        try {
            const height = await this.#httpProvider.getBlockNumber();
            await this.#onBlock(height);
        } catch (err: unknown) {
            console.error('Poll error:', (err as Error).message);
        }
    }
}
