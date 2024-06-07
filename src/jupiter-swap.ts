import {Connection, Keypair, PublicKey, VersionedTransaction} from '@solana/web3.js';
import {Wallet} from '@project-serum/anchor';
// @ts-ignore
import bs58 from 'bs58';
import { transactionSenderAndConfirmationWaiter } from "./jupiter/utils/transactionSender";
import { getSignature } from "./jupiter/utils/getSignature";
import {MintLayout, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {ethers} from "ethers";

import {
    QuoteGetRequest,
    QuoteResponse,
    SwapResponse,
    createJupiterApiClient,
} from "./jupiter"



export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const privateKey = '5GG56ywXgfd6Pmv7zZJXMvmAMNPzfzipGxxpk7VxUjjacjyLWHNazLXR8FceofNk6dEDYSGbmBc6HbZ1mPXGEm7Z';
const connection = new Connection(SOLANA_RPC_URL);
const jupiterQuoteApi = createJupiterApiClient();

async function getQuote(inputMint: string, outputMint: string, amount: number) {
    // basic params
    // const params: QuoteGetRequest = {
    //   inputMint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    //   outputMint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    //   amount: 35281,
    //   slippageBps: 50,
    //   onlyDirectRoutes: false,
    //   asLegacyTransaction: false,
    // }

    // auto slippage w/ minimizeSlippage params
    const params: QuoteGetRequest = {
        inputMint,
        outputMint, // $WIF
        amount, // 0.2$
        autoSlippage: true,
        autoSlippageCollisionUsdValue: 1_000,
        maxAutoSlippageBps: 1000, // 10%
        minimizeSlippage: true,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
    };

    // get quote
    const quote = await jupiterQuoteApi.quoteGet(params);

    if (!quote) {
        throw new Error("unable to quote");
    }
    return quote;
}


async function getSwapObj(wallet: Wallet, quote: QuoteResponse) {
    // Get serialized transaction
    const swapObj = await jupiterQuoteApi.swapPost({
        swapRequest: {
            quoteResponse: quote,
            userPublicKey: wallet.publicKey.toBase58(),
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: "auto",
        },
    });
    return swapObj;
}



const getSolanaBalance = async (address: any, tokenMintAddress: any) => {
    // const clusterUrl = 'https://api.mainnet-beta.solana.com'; // Replace with the appropriate cluster URL if needed.
    // const clusterUrl = 'https://api.devnet.solana.com'; // Replace with the appropriate cluster URL if needed.
    const ownerPublicKey = new PublicKey(address);
    const tokenMintPublicKey = new PublicKey(tokenMintAddress);

    try {

        if (tokenMintAddress === 'So11111111111111111111111111111111111111112') {
            // Get SOL balance
            const balance = await connection.getBalance(ownerPublicKey);
            return {
                value: balance,
                decimals: 9,
                formatted: balance / 1e9
            }; // Use proper division for lamports to SOL
        }

        const tokenInfo = await connection.getAccountInfo(tokenMintPublicKey);
        const parsedTokenInfo = MintLayout.decode(tokenInfo?.data);
        // console.log("parsedTokenInfo", parsedTokenInfo);

        const accounts = await connection.getParsedTokenAccountsByOwner(ownerPublicKey, {
            programId: TOKEN_PROGRAM_ID,
            mint: tokenMintPublicKey,
        });

        if (accounts.value.length === 0) {
            console.log('No token accounts found for the specified owner and token mint.');
            return {
                value: 0,
                formatted: 0,
                decimals: parsedTokenInfo.decimals
            };
        }

        let balance = 0;
        accounts.value.forEach((accountInfo) => {
            balance += parseInt(accountInfo.account.data.parsed.info.tokenAmount.amount, 10);
        });

        console.log(`Total balance for token ${tokenMintAddress} is:`, balance);
        return {
            value: balance,
            formatted: balance / Math.pow(10, parsedTokenInfo.decimals),
            decimals: parsedTokenInfo.decimals
        };

    } catch (error) {
        console.error('Error getting balance:', error);
        throw error;
    }
};


const doAction = async () => {

    const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));
    const walletAddress = wallet.publicKey.toString();
    console.log("wallet address is ", walletAddress);


    const inToken = {
        address: `So11111111111111111111111111111111111111112`,
        decimals: 9
    }

    const outToken = {
        address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
        decimals: 6
    }


    const inTokenBalance = await getSolanaBalance(walletAddress, inToken.address);
    const outTokenBalance = await getSolanaBalance(walletAddress, outToken.address);
    console.log("inTokenBalance", inTokenBalance);
    console.log("outTokenBalance", outTokenBalance);


    const amountInWei = ethers.utils.parseUnits('0.00065271', inToken?.decimals);


    console.log("Wallet:", wallet.publicKey.toBase58());

    const quote = await getQuote(inToken.address, outToken.address, amountInWei.toNumber());
    console.log(quote, { depth: null });
    const swapObj = await getSwapObj(wallet, quote);
    console.log(swapObj, { depth: null });

    // Serialize the transaction
    const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Sign the transaction
    transaction.sign([wallet.payer]);
    const signature = getSignature(transaction);

    // We first simulate whether the transaction would be successful
    const { value: simulatedTransactionResponse } =
        await connection.simulateTransaction(transaction, {
            replaceRecentBlockhash: true,
            commitment: "processed",
        });
    const { err, logs } = simulatedTransactionResponse;

    if (err) {
        // Simulation error, we can check the logs for more details
        // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
        console.error("Simulation Error:");
        console.error({ err, logs });
        return;
    }

    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;

    const transactionResponse = await transactionSenderAndConfirmationWaiter({
        connection,
        serializedTransaction,
        blockhashWithExpiryBlockHeight: {
            blockhash,
            lastValidBlockHeight: swapObj.lastValidBlockHeight,
        },
    });

    // If we are not getting a response back, the transaction has not confirmed.
    if (!transactionResponse) {
        console.error("Transaction not confirmed");
        return;
    }

    if (transactionResponse.meta?.err) {
        console.error(transactionResponse.meta?.err);
    }

    console.log(`https://solscan.io/tx/${signature}`);


}


doAction();
