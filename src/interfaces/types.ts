import { OPNetTransactionTypes, TransactionBase } from 'opnet';

export type TransactionLike = TransactionBase<OPNetTransactionTypes>;
export type BitcoinTransferTransaction = TransactionBase<OPNetTransactionTypes.Generic>;
export type InteractionTransaction = TransactionBase<OPNetTransactionTypes.Interaction>;
