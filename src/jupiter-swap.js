import {Connection, Keypair, PublicKey, VersionedTransaction} from '@solana/web3.js';
import fetch from 'cross-fetch';
import {Wallet} from '@project-serum/anchor';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import {MintLayout, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {ethers} from "ethers";
// export const SOLANA_RPC_URL = 'https://go.getblock.io/7f0cd0e44c2d4ad684de1151c238bae3';
export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const privateKey = '5GG56ywXgfd6Pmv7zZJXMvmAMNPzfzipGxxpk7VxUjjacjyLWHNazLXR8FceofNk6dEDYSGbmBc6HbZ1mPXGEm7Z';

// It is recommended that you use your own RPC endpoint.
// This RPC endpoint is only for demonstration purposes so that this example will run.
const connection = new Connection(SOLANA_RPC_URL);


const getSolanaBalance = async (address, tokenMintAddress) => {
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
    const quoteResponse = await (
        await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inToken?.address}&outputMint=${outToken?.address}&amount=${amountInWei.toString()}&slippageBps=80`
        )).json();

    console.log("quoteResponse", quoteResponse);


    const {swapTransaction} = await (
        await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                // quoteResponse from /quote api
                quoteResponse,
                // user public key to be used for the swap
                userPublicKey: walletAddress,
                // auto wrap and unwrap SOL. default is true
                wrapAndUnwrapSol: true,
                // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
                // feeAccount: "fee_account_public_key"
            })
        })
    ).json();


// deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    console.log(transaction);

    console.log(`sign with ${wallet.payer}`);
// sign the transaction
    // const signed = transaction.sign([signer]);
    await wallet.signTransaction(transaction);
    console.log(`successfully signed!`);

    const rawTransaction = transaction.serialize()
    console.log(`send Raw Trasaction ...`);
    const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
    });
    await connection.confirmTransaction(txid);
    console.log(`https://solscan.io/tx/${txid}`);

}


doAction();
