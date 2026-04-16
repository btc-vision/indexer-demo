import {
    type Block,
    type getContract,
    InteractionTransaction,
    type IOP20Contract,
    OPNetEvent,
    OPNetTransactionTypes,
    type TransferredEvent,
} from 'opnet';

export interface ParsedOP20TransferTransaction {
    readonly transaction: InteractionTransaction;
    readonly events: OPNetEvent[];
}

export class BlockParser {
    readonly #contract: ReturnType<typeof getContract<IOP20Contract>>;
    readonly #contractAddress: string;

    public constructor(
        contract: ReturnType<typeof getContract<IOP20Contract>>,
        contractAddress: string,
    ) {
        this.#contract = contract;
        this.#contractAddress = contractAddress;
    }

    /**
     * Parses all transactions in a block into typed events.
     *
     * @param block - The block data containing transactions.
     * @returns An array of parsed OP20 and BTC transfer events.
     */
    public parse(block: Block): InteractionTransaction[] {
        const results: InteractionTransaction[] = [];

        for (const tx of block.transactions) {
            if (tx.OPNetType !== OPNetTransactionTypes.Interaction) {
                continue;
            }

            results.push(tx as InteractionTransaction);
        }

        return results;
    }

    public parseOP20Transfers(txs: InteractionTransaction[]): ParsedOP20TransferTransaction[] {
        const results: ParsedOP20TransferTransaction[] = [];

        for (const tx of txs) {
            const op20Events = this.#parseInteractionOP20Transfer(tx);

            if (op20Events.length) {
                results.push({
                    transaction: tx,
                    events: op20Events,
                });
            }
        }

        return results;
    }

    #parseInteractionOP20Transfer(tx: InteractionTransaction): OPNetEvent<TransferredEvent>[] {
        if (tx.contractAddress !== this.#contractAddress) return [];
        if (!tx.events) return [];

        const decoded = this.#contract.decodeEvents(tx.events);

        const transferredEvents: OPNetEvent<TransferredEvent>[] = [];
        for (const event of decoded) {
            if (event.type === 'Transferred') {
                transferredEvents.push(event as OPNetEvent<TransferredEvent>);
            }
        }

        return transferredEvents;
    }
}
